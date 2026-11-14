<template>
    <div class="slice-image" :class="{ enabled }">
        <button
            v-if="enabled"
            type="button"
            class="slice-strip slice-strip-left"
            :aria-label="`Horizontal slice selector for ${image.name}`"
            title="Move to preview a horizontal slice; click to open its graph"
            @pointermove="preview($event, 'horizontal')"
            @pointerleave="selection = undefined"
            @focus="center('horizontal')"
            @blur="selection = undefined"
            @click="choose($event, 'horizontal')"
            @keydown="keyboard($event, 'horizontal')">
            <span
                class="strip-range"
                :style="{
                    top: `${rect.top}px`,
                    height: `${rect.height}px`
                }"></span>
            <span class="strip-label">Row</span>
        </button>
        <div
            ref="viewport"
            class="slice-viewport"
            :class="{ inspecting: inspect }"
            @pointermove="inspectPixel"
            @pointerleave="leavePixel">
            <img
                :src="image.previewDataUrl"
                :alt="image.name"
                draggable="false"
                @load="loaded" />
            <div
                v-if="enabled && selection"
                class="slice-line"
                :style="lineStyle"></div>
            <span
                v-if="enabled && selection"
                class="slice-index"
                aria-live="polite">
                {{ selection.orientation === "horizontal" ? "Row" : "Column" }}
                {{ selection.index }}
            </span>
            <div
                v-if="inspect && pixelPosition"
                class="pixel-readout"
                role="status"
                aria-live="polite">
                <div>
                    Row {{ pixelPosition.row }} · Column
                    {{ pixelPosition.column }} (zero-based)
                </div>
                <div v-if="pixelError">{{ pixelError }}</div>
                <div v-else-if="pixelData">
                    {{ pixelData.valueLabel }}:
                    {{
                        pixelData.value === null
                            ? "Not available"
                            : Number(pixelData.value.toPrecision(7))
                    }}
                </div>
                <div v-else>Reading pixel…</div>
            </div>
        </div>
        <button
            v-if="enabled"
            type="button"
            class="slice-strip slice-strip-bottom"
            :aria-label="`Vertical slice selector for ${image.name}`"
            title="Move to preview a vertical slice; click to open its graph"
            @pointermove="preview($event, 'vertical')"
            @pointerleave="selection = undefined"
            @focus="center('vertical')"
            @blur="selection = undefined"
            @click="choose($event, 'vertical')"
            @keydown="keyboard($event, 'vertical')">
            <span
                class="strip-range"
                :style="{
                    left: `${rect.left}px`,
                    width: `${rect.width}px`
                }"></span>
            <span class="strip-label">Column</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ImageInfo } from "@/types/image";
import type { SliceOrientation, SliceSelection } from "@/types/slice";
import { sliceAtOffset } from "@/utils/image-slice";
import { previewPixel } from "@/utils/image-pixel";
import type { PixelData, PixelPosition } from "@/types/pixel";
const props = defineProps<{
    image: ImageInfo;
    enabled: boolean;
    inspect?: boolean;
}>();
const emit = defineEmits<{ slice: [selection: SliceSelection] }>();
const viewport = ref<HTMLDivElement>();
const width = ref(0);
const height = ref(0);
const naturalWidth = ref(0);
const naturalHeight = ref(0);
const selection = ref<SliceSelection>();
const pixelPosition = ref<PixelPosition>();
const pixelData = ref<PixelData>();
const pixelError = ref("");
let pixelTimer: ReturnType<typeof setTimeout> | undefined;
let pixelVersion = 0;
let pixelRunning = false;
let lastPointer: { clientX: number; clientY: number } | undefined;
let pendingPixel:
    | { image: ImageInfo; position: PixelPosition; version: number }
    | undefined;
function clearPixel() {
    clearTimeout(pixelTimer);
    pendingPixel = undefined;
    pixelVersion++;
    pixelPosition.value = undefined;
    pixelData.value = undefined;
    pixelError.value = "";
}
function leavePixel() {
    lastPointer = undefined;
    clearPixel();
}
function inspectPixel(event: PointerEvent) {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    refreshPixel();
}
function refreshPixel() {
    if (!props.inspect || !viewport.value || !lastPointer) {
        return;
    }
    const event = lastPointer;
    const bounds = viewport.value.getBoundingClientRect();
    // Pointer events can arrive before ResizeObserver delivers the new size.
    if (bounds.width > 0 && bounds.height > 0) {
        width.value = bounds.width;
        height.value = bounds.height;
    }
    const column = sliceAtOffset(
        event.clientX - bounds.left,
        rect.value.left,
        rect.value.width,
        sourceWidth.value
    );
    const row = sliceAtOffset(
        event.clientY - bounds.top,
        rect.value.top,
        rect.value.height,
        sourceHeight.value
    );
    if (row === null || column === null) {
        clearPixel();
        return;
    }
    if (
        pixelPosition.value?.row === row &&
        pixelPosition.value?.column === column
    ) {
        return;
    }
    clearPixel();
    pixelPosition.value = { row, column };
    const request = {
        image: props.image,
        position: { row, column },
        version: pixelVersion
    };
    // Coalesce pointer movement and allow only one source read at a time.
    pixelTimer = setTimeout(() => {
        pendingPixel = request;
        void readPixel();
    }, 150);
}
async function readPixel() {
    if (pixelRunning || !pendingPixel) {
        return;
    }
    const request = pendingPixel;
    pendingPixel = undefined;
    pixelRunning = true;
    try {
        const { image, position } = request;
        const data = image.supportsSourcePixels
            ? await window.images!.pixel(
                  image.path,
                  image.pluginId,
                  position.row,
                  position.column,
                  image.scaling
              )
            : await previewPixel(image, position.row, position.column);
        if (request.version === pixelVersion) {
            pixelData.value = data;
        }
    } catch (cause) {
        if (request.version === pixelVersion) {
            pixelError.value =
                cause instanceof Error
                    ? cause.message
                    : "Unable to read pixel.";
        }
    } finally {
        pixelRunning = false;
        if (pendingPixel) {
            void readPixel();
        }
    }
}
watch(() => [props.inspect, props.image], leavePixel);
let observer: ResizeObserver | undefined;
const sourceWidth = computed(() => props.image.width ?? naturalWidth.value);
const sourceHeight = computed(() => props.image.height ?? naturalHeight.value);
const rect = computed(() => {
    const w = naturalWidth.value || sourceWidth.value;
    const h = naturalHeight.value || sourceHeight.value;
    const scale = w && h ? Math.min(width.value / w, height.value / h) : 0;
    return {
        left: (width.value - w * scale) / 2,
        top: (height.value - h * scale) / 2,
        width: w * scale,
        height: h * scale
    };
});
const lineStyle = computed(() => {
    if (!selection.value) {
        return {};
    }
    const horizontal = selection.value.orientation === "horizontal";
    const fraction =
        (selection.value.index + 0.5) /
        (horizontal ? sourceHeight.value : sourceWidth.value);
    return horizontal
        ? {
              left: `${rect.value.left}px`,
              top: `${rect.value.top + fraction * rect.value.height}px`,
              width: `${rect.value.width}px`,
              height: "2px"
          }
        : {
              left: `${rect.value.left + fraction * rect.value.width}px`,
              top: `${rect.value.top}px`,
              width: "2px",
              height: `${rect.value.height}px`
          };
});
function loaded(event: Event) {
    const image = event.target as HTMLImageElement;
    naturalWidth.value = image.naturalWidth;
    naturalHeight.value = image.naturalHeight;
    refreshPixel();
}
function preview(event: MouseEvent, orientation: SliceOrientation) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const horizontal = orientation === "horizontal";
    const index = sliceAtOffset(
        horizontal ? event.clientY - bounds.top : event.clientX - bounds.left,
        horizontal ? rect.value.top : rect.value.left,
        horizontal ? rect.value.height : rect.value.width,
        horizontal ? sourceHeight.value : sourceWidth.value
    );
    selection.value = index === null ? undefined : { orientation, index };
}
function choose(event: MouseEvent, orientation: SliceOrientation) {
    // Keyboard activation synthesizes a click without pointer coordinates.
    if (event.detail !== 0) {
        preview(event, orientation);
    }
    if (selection.value?.orientation === orientation) {
        emit("slice", { ...selection.value });
    }
}
function center(orientation: SliceOrientation) {
    const length =
        orientation === "horizontal" ? sourceHeight.value : sourceWidth.value;
    if (length > 0) {
        selection.value = { orientation, index: Math.floor(length / 2) };
    }
}
function keyboard(event: KeyboardEvent, orientation: SliceOrientation) {
    const delta = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[
        event.key
    ];
    if (delta === undefined) {
        return;
    }
    event.preventDefault();
    if (selection.value?.orientation !== orientation) {
        center(orientation);
    }
    if (!selection.value) {
        return;
    }
    const length =
        orientation === "horizontal" ? sourceHeight.value : sourceWidth.value;
    selection.value = {
        orientation,
        index: Math.max(
            0,
            Math.min(
                length - 1,
                selection.value.index + delta * (event.shiftKey ? 10 : 1)
            )
        )
    };
}
watch(
    () => props.enabled,
    () => {
        selection.value = undefined;
    }
);
onMounted(() => {
    observer = new ResizeObserver(entries => {
        const size = entries[0]?.contentRect;
        if (
            size &&
            (size.width !== width.value || size.height !== height.value)
        ) {
            width.value = size.width;
            height.value = size.height;
            if (lastPointer) {
                refreshPixel();
            }
        }
    });
    if (viewport.value) {
        observer.observe(viewport.value);
    }
});
onBeforeUnmount(() => {
    leavePixel();
    observer?.disconnect();
});
</script>

<style scoped>
.slice-image {
    display: grid;
    grid-template-columns: 0 minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
}
.slice-image.enabled {
    grid-template-columns: 28px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) 28px;
    background: #263b51;
}
.slice-viewport {
    position: relative;
    grid-column: 2;
    grid-row: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}
.slice-viewport img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.slice-strip {
    position: relative;
    border: 0;
    padding: 0;
    background: #263b51;
    color: #d9e7f5;
    font: 10px sans-serif;
    cursor: crosshair;
    overflow: hidden;
}
.slice-strip-left {
    grid-column: 1;
    grid-row: 1;
}
.slice-strip-bottom {
    grid-column: 2;
    grid-row: 2;
}
.strip-range {
    position: absolute;
    background: #365572;
    inset: 0;
}
.strip-label {
    position: relative;
    pointer-events: none;
}
.slice-strip-left .strip-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
}
.slice-strip:focus-visible {
    outline: 2px solid #ffca28;
    outline-offset: -2px;
}
.slice-line {
    position: absolute;
    background: #ffca28;
    box-shadow: 0 0 2px #111;
    pointer-events: none;
}
.slice-index {
    position: absolute;
    left: 8px;
    bottom: 8px;
    color: #fff;
    background: #162330df;
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 11px;
    pointer-events: none;
}

.slice-viewport.inspecting {
    cursor: crosshair;
}
.pixel-readout {
    position: absolute;
    left: 8px;
    top: 8px;
    max-width: calc(100% - 16px);
    padding: 5px 8px;
    border-radius: 3px;
    background: #162330ed;
    color: white;
    font-size: 11px;
    pointer-events: none;
    overflow-wrap: anywhere;
}
</style>
