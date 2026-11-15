<template>
    <svg
        v-if="polygon?.length || (drawing && draft.length)"
        class="polygon-overlay"
        aria-label="Selected image region">
        <polygon
            v-if="polygon?.length && !(drawing && draft.length)"
            :points="polygonPixels(polygon)"
            class="closed-polygon" />
        <polyline
            v-if="drawing && draft.length"
            :points="polygonPixels(cursor ? [...draft, cursor] : draft)"
            class="draft-polygon" />
        <circle
            v-for="(point, index) in drawing ? draft : []"
            :key="index"
            :cx="rect.left + (point.column / sourceWidth) * rect.width"
            :cy="rect.top + (point.row / sourceHeight) * rect.height"
            :r="index === 0 ? 5 : 3" />
    </svg>
    <div v-if="drawing" class="polygon-hint">
        {{
            polygonError ||
            "Click vertices; click the first point, double-click, or press Enter to close. Esc cancels; Backspace undoes."
        }}
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, toRefs } from "vue";
import type { PolygonPoint } from "@/types/region";
import type { ImageDisplayRect } from "@/types/image-view";
import { validatePolygon } from "@/types/region";

const props = defineProps<{
    drawing: boolean;

    polygon?: PolygonPoint[] | undefined;

    sourceWidth: number;

    sourceHeight: number;

    rect: ImageDisplayRect;

    viewport: HTMLDivElement | undefined;

    pointAt: (event: MouseEvent) => PolygonPoint | undefined;
}>();

const { sourceWidth, sourceHeight, rect, viewport } = toRefs(props);
const emit = defineEmits<{
    region: [points: PolygonPoint[]];

    cancelRegion: [];

    drawingChange: [];
}>();

const draft = ref<PolygonPoint[]>([]);
const cursor = ref<PolygonPoint>();
const polygonError = ref("");

/**
 * Map source polygon vertices to the fitted SVG overlay coordinate system.
 */
function polygonPixels(points: PolygonPoint[]) {
    return points
        .map(
            point =>
                `${rect.value.left + (point.column / sourceWidth.value) * rect.value.width},${rect.value.top + (point.row / sourceHeight.value) * rect.value.height}`
        )
        .join(" ");
}

/**
 * Append a source-coordinate polygon vertex or close the draft near its
 * first vertex.
 */
function polygonClick(event: MouseEvent) {
    if (!props.drawing || event.detail > 1) {
        return;
    }

    viewport.value?.focus({ preventScroll: true });

    const point = props.pointAt(event);

    if (!point) {
        return;
    }

    polygonError.value = "";

    const first = draft.value[0];

    if (
        draft.value.length >= 3 &&
        first &&
        Math.hypot(
            ((first.column - point.column) / sourceWidth.value) *
                rect.value.width,
            ((first.row - point.row) / sourceHeight.value) * rect.value.height
        ) <= 8
    ) {
        finishPolygon();

        return;
    }

    const last = draft.value.at(-1);

    if (
        last &&
        Math.hypot(last.row - point.row, last.column - point.column) < 1e-8
    ) {
        return;
    }

    if (draft.value.length === 256) {
        polygonError.value =
            "Close the polygon or undo a vertex (maximum 256).";

        return;
    }

    draft.value.push(point);
}

/**
 * Validate the closed polygon and emit it for region analysis; retain
 * validation errors inline.
 */
function finishPolygon() {
    if (!props.drawing) {
        return;
    }

    try {
        const points = validatePolygon(
            draft.value,
            sourceWidth.value,
            sourceHeight.value
        );

        emit("region", points);
        draft.value = [];
        cursor.value = undefined;
    } catch (cause) {
        polygonError.value =
            cause instanceof Error ? cause.message : "Invalid polygon.";
    }
}

/**
 * Handle polygon confirmation, cancellation, and vertex undo shortcuts.
 */
function polygonKeyboard(event: KeyboardEvent) {
    if (
        !props.drawing ||
        !["Enter", "Escape", "Backspace", "Delete"].includes(event.key)
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Enter") {
        finishPolygon();
    } else if (event.key === "Escape") {
        emit("cancelRegion");
    } else {
        draft.value.pop();
        polygonError.value = "";
    }
}

watch(
    () => props.drawing,
    () => {
        draft.value = [];
        cursor.value = undefined;
        polygonError.value = "";
        emit("drawingChange");

        if (props.drawing) {
            void nextTick(() => viewport.value?.focus({ preventScroll: true }));
        }
    }
);

/** Update the draft edge preview using the viewport's source-coordinate mapper. */
function movePointer(event: PointerEvent) {
    if (props.drawing) {
        cursor.value = props.pointAt(event);
    }
}
/** Clear the temporary draft edge when the pointer leaves the viewport. */
function leavePointer() {
    cursor.value = undefined;
}
defineExpose({
    polygonClick,
    finishPolygon,
    polygonKeyboard,
    movePointer,
    leavePointer
});
</script>

<style scoped>
.polygon-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.closed-polygon {
    fill: #26c6da28;
    stroke: #26c6da;
    stroke-width: 2;
}

.draft-polygon {
    fill: none;
    stroke: #ffca28;
    stroke-width: 2;
    stroke-dasharray: 5 3;
}

.polygon-overlay circle {
    fill: #ffca28;
    stroke: #111b27;
    stroke-width: 1;
}

.polygon-hint {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    padding: 5px 8px;
    background: #162330ed;
    color: white;
    font-size: 11px;
    pointer-events: none;
}
</style>
