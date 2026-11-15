<template>
    <svg
        v-if="cropping && cropRectangle"
        class="polygon-overlay"
        aria-label="Crop selection">
        <rect
            :x="rect.left + (cropRectangle.left / sourceWidth) * rect.width"
            :y="rect.top + (cropRectangle.top / sourceHeight) * rect.height"
            :width="(cropRectangle.width / sourceWidth) * rect.width"
            :height="(cropRectangle.height / sourceHeight) * rect.height"
            class="crop-rectangle" />
    </svg>
    <div
        v-if="cropping"
        class="polygon-hint crop-hint"
        @pointerdown.stop
        @click.stop>
        <span>
            {{
                cropRectangle
                    ? `${cropRectangle.width} × ${cropRectangle.height} pixels`
                    : "Drag a rectangle to crop"
            }}
        </span>
        <button type="button" :disabled="!cropRectangle" @click="confirmCrop">
            Create Crop
        </button>
        <button type="button" @click="$emit('cancelCrop')">Cancel</button>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, toRefs } from "vue";
import type { PolygonPoint } from "@/types/region";
import type { ImageDisplayRect } from "@/types/image-view";
import type { ImageCrop } from "@/types/crop";

const props = defineProps<{
    cropping: boolean;

    sourceWidth: number;

    sourceHeight: number;

    rect: ImageDisplayRect;

    viewport: HTMLDivElement | undefined;

    pointAt: (event: MouseEvent) => PolygonPoint | undefined;
}>();

const { sourceWidth, sourceHeight, rect, viewport } = toRefs(props);
const emit = defineEmits<{
    crop: [selection: ImageCrop];

    cancelCrop: [];
}>();

const cropStart = ref<PolygonPoint>();
const cropEnd = ref<PolygonPoint>();
let cropPointer: number | undefined;

const cropRectangle = computed(() => {
    if (!cropStart.value || !cropEnd.value) {
        return undefined;
    }

    const left = Math.max(
        0,
        Math.floor(Math.min(cropStart.value.column, cropEnd.value.column))
    );
    const top = Math.max(
        0,
        Math.floor(Math.min(cropStart.value.row, cropEnd.value.row))
    );
    const right = Math.min(
        sourceWidth.value,
        Math.ceil(Math.max(cropStart.value.column, cropEnd.value.column))
    );
    const bottom = Math.min(
        sourceHeight.value,
        Math.ceil(Math.max(cropStart.value.row, cropEnd.value.row))
    );

    if (right <= left || bottom <= top) {
        return undefined;
    }

    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
        sourceWidth: sourceWidth.value,
        sourceHeight: sourceHeight.value
    };
});

/**
 * Start a source-coordinate crop drag only when the pointer is inside the
 * fitted image.
 */
function startCrop(event: PointerEvent) {
    if (!props.cropping || event.button !== 0) {
        return;
    }

    const point = props.pointAt(event);

    if (!point) {
        return;
    }

    event.preventDefault();
    viewport.value?.focus({ preventScroll: true });
    viewport.value?.setPointerCapture(event.pointerId);
    cropPointer = event.pointerId;
    cropStart.value = point;
    cropEnd.value = undefined;
}

/**
 * Update the dragged crop corner, clamping captured pointer movement to
 * source image bounds.
 */
function moveCrop(event: PointerEvent) {
    if (!props.cropping || cropPointer !== event.pointerId || !viewport.value) {
        return;
    }

    const bounds = viewport.value.getBoundingClientRect();

    cropEnd.value = {
        row: Math.max(
            0,
            Math.min(
                sourceHeight.value,
                ((event.clientY - bounds.top - rect.value.top) /
                    rect.value.height) *
                    sourceHeight.value
            )
        ),
        column: Math.max(
            0,
            Math.min(
                sourceWidth.value,
                ((event.clientX - bounds.left - rect.value.left) /
                    rect.value.width) *
                    sourceWidth.value
            )
        )
    };
}

/**
 * Finish the crop drag and release pointer capture without applying the
 * selection yet.
 */
function endCrop(event: PointerEvent) {
    if (cropPointer !== event.pointerId) {
        return;
    }

    moveCrop(event);
    cropPointer = undefined;
    viewport.value?.releasePointerCapture(event.pointerId);
}

/**
 * Clear an unfinished crop rectangle and its captured pointer identifier.
 */
function cancelCropDrag() {
    cropPointer = undefined;
    cropStart.value = undefined;
    cropEnd.value = undefined;
}

/**
 * Emit the selected integer source-pixel rectangle for creation in a
 * separate window.
 */
function confirmCrop() {
    if (cropRectangle.value) {
        emit("crop", { ...cropRectangle.value });
    }
}

/**
 * Confirm a crop from the viewport with Enter or leave crop mode with
 * Escape.
 */
function cropKeyboard(event: KeyboardEvent) {
    if (!props.cropping) {
        return;
    }

    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancelCrop");
    } else if (event.key === "Enter" && event.target === viewport.value) {
        event.preventDefault();
        confirmCrop();
    }
}

watch(
    () => props.cropping,
    () => {
        cancelCropDrag();

        if (props.cropping) {
            void nextTick(() => viewport.value?.focus({ preventScroll: true }));
        }
    }
);

defineExpose({ startCrop, moveCrop, endCrop, cancelCropDrag, cropKeyboard });
</script>

<style scoped>
.polygon-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
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

.crop-rectangle {
    fill: rgb(25 118 210 / 18%);
    stroke: #ffdc64;
    stroke-width: 2;
    stroke-dasharray: 6 3;
}

.crop-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
}

.crop-hint button {
    padding: 4px 8px;
    cursor: pointer;
}
</style>
