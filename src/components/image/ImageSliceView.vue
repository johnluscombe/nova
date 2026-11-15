<template>
    <div class="slice-image" :class="{ enabled, 'axes-enabled': axes }">
        <ImageAxes
            v-if="axes"
            :axes="imageAxes"
            :width="sourceWidth"
            :height="sourceHeight"
            :rect="rect" />
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
            <span class="strip-label">
                {{ image.axes?.row.label ?? "Row" }}
            </span>
        </button>
        <div
            ref="viewport"
            class="slice-viewport"
            :class="{ inspecting: inspect || drawing || cropping }"
            :tabindex="drawing || cropping ? 0 : undefined"
            @pointerdown="cropOverlay?.startCrop($event)"
            @pointerup="cropOverlay?.endCrop($event)"
            @pointercancel="cropOverlay?.cancelCropDrag()"
            @click="regionOverlay?.polygonClick($event)"
            @dblclick.prevent="regionOverlay?.finishPolygon()"
            @keydown="
                cropOverlay?.cropKeyboard($event);
                regionOverlay?.polygonKeyboard($event);
            "
            @pointermove="
                cropOverlay?.moveCrop($event);
                regionOverlay?.movePointer($event);
                inspectPixel($event);
            "
            @pointerleave="
                leavePixel();
                regionOverlay?.leavePointer();
            ">
            <img
                :src="previewUrl ?? image.previewDataUrl"
                :alt="image.name"
                draggable="false"
                @load="loaded" />
            <ImageCropOverlay
                ref="cropOverlay"
                :cropping="!!cropping"
                :source-width="sourceWidth"
                :source-height="sourceHeight"
                :rect="rect"
                :viewport="viewport"
                :point-at="imagePoint"
                @crop="$emit('crop', $event)"
                @cancel-crop="$emit('cancelCrop')" />
            <ImageRegionOverlay
                ref="regionOverlay"
                :drawing="!!drawing"
                :polygon="polygon"
                :source-width="sourceWidth"
                :source-height="sourceHeight"
                :rect="rect"
                :viewport="viewport"
                :point-at="imagePoint"
                @region="$emit('region', $event)"
                @cancel-region="$emit('cancelRegion')"
                @drawing-change="leavePixel" />
            <div
                v-if="enabled && selection"
                class="slice-line"
                :style="lineStyle"></div>
            <span
                v-if="enabled && selection"
                class="slice-index"
                aria-live="polite">
                {{
                    image.axes
                        ? slicePosition(
                              image,
                              selection.orientation,
                              selection.index
                          )
                        : `${selection.orientation === "horizontal" ? "Row" : "Column"} ${selection.index}`
                }}
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
                <div v-if="axes && image.axes">
                    {{ imageAxes.row.label }}:
                    {{
                        coordinate(
                            axisCoordinate(imageAxes.row, pixelPosition.row)
                        )
                    }}
                    {{ imageAxes.row.unit }} · {{ imageAxes.column.label }}:
                    {{
                        coordinate(
                            axisCoordinate(
                                imageAxes.column,
                                pixelPosition.column
                            )
                        )
                    }}
                    {{ imageAxes.column.unit }}
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
            <span class="strip-label">
                {{ image.axes?.column.label ?? "Column" }}
            </span>
        </button>
    </div>
</template>

<script setup lang="ts">
import type { ImageCrop } from "@/types/crop";
import type { PolygonPoint } from "@/types/region";
import { slicePosition } from "@/utils/slice-axes";
import ImageCropOverlay from "@/components/image/ImageCropOverlay.vue";
import ImageRegionOverlay from "@/components/image/ImageRegionOverlay.vue";
import ImageAxes from "@/components/image/ImageAxes.vue";
import { axisCoordinate } from "@/types/axes";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ImageInfo } from "@/types/image";
import type { SliceOrientation, SliceSelection } from "@/types/slice";
import { sliceAtOffset } from "@/utils/image-slice";
import { previewPixel } from "@/utils/image-pixel";
import type { PixelData, PixelPosition } from "@/types/pixel";

const props = defineProps<{
    previewUrl?: string | undefined;

    image: ImageInfo;

    enabled: boolean;

    inspect?: boolean;

    axes?: boolean;

    drawing?: boolean;

    cropping?: boolean;

    polygon?: PolygonPoint[] | undefined;
}>();

const emit = defineEmits<{
    slice: [selection: SliceSelection];

    region: [polygon: PolygonPoint[]];

    cancelRegion: [];

    crop: [selection: ImageCrop];

    cancelCrop: [];
}>();

const cropOverlay = ref<InstanceType<typeof ImageCropOverlay>>();
const regionOverlay = ref<InstanceType<typeof ImageRegionOverlay>>();
const viewport = ref<HTMLDivElement>();
let observer: ResizeObserver | undefined;

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
let lastPointer:
    | {
          clientX: number;

          clientY: number;
      }
    | undefined;
let pendingPixel:
    | {
          image: ImageInfo;

          position: PixelPosition;

          version: number;
      }
    | undefined;

const sourceWidth = computed(() => props.image.width ?? naturalWidth.value);
const sourceHeight = computed(() => props.image.height ?? naturalHeight.value);
const imageAxes = computed(
    () =>
        props.image.axes ?? {
            row: {
                label: "Row",
                unit: "pixel" as const,
                origin: 0,
                spacing: 1
            },
            column: {
                label: "Column",
                unit: "pixel" as const,
                origin: 0,
                spacing: 1
            }
        }
);

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

/**
 * Convert viewport pointer coordinates to source-pixel edge coordinates.
 *
 * @returns A fractional row/column position, or undefined when the pointer
 * is in letterboxing or the fitted image is not ready.
 */
function imagePoint(event: MouseEvent): PolygonPoint | undefined {
    if (!viewport.value || !rect.value.width || !rect.value.height) {
        return;
    }

    const bounds = viewport.value.getBoundingClientRect();
    const x = event.clientX - bounds.left - rect.value.left,
        y = event.clientY - bounds.top - rect.value.top;

    if (x < 0 || y < 0 || x > rect.value.width || y > rect.value.height) {
        return;
    }

    return {
        row: (y / rect.value.height) * sourceHeight.value,
        column: (x / rect.value.width) * sourceWidth.value
    };
}

/**
 * Invalidate in-flight pixel results and clear the current inspection
 * readout.
 */
function clearPixel() {
    clearTimeout(pixelTimer);
    pendingPixel = undefined;
    pixelVersion++;
    pixelPosition.value = undefined;
    pixelData.value = undefined;
    pixelError.value = "";
}

/**
 * Forget the pointer location and clear inspection when it leaves the
 * image viewport.
 */
function leavePixel() {
    lastPointer = undefined;
    clearPixel();
}

/**
 * Update the drawing cursor or schedule inspection at the latest pointer
 * location.
 */
function inspectPixel(event: PointerEvent) {
    if (props.cropping) {
        return;
    }

    if (props.drawing) {
        return;
    }

    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    refreshPixel();
}

/**
 * Map the pointer through the fitted image and debounce source reads for
 * the selected pixel.
 */
function refreshPixel() {
    if (
        !props.inspect ||
        props.drawing ||
        props.cropping ||
        !viewport.value ||
        !lastPointer
    ) {
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

/**
 * Read one pending source or preview value at a time.
 *
 * Requests carry a version token so closing inspection, changing scaling, or
 * moving to another pixel cannot display an obsolete response.
 */
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

/**
 * Format an inspection coordinate to seven significant digits.
 */
function coordinate(value: number) {
    return Number(value.toPrecision(7)).toString();
}

/**
 * Record decoded preview dimensions so fitting and source-coordinate
 * mapping can be updated.
 */
function loaded(event: Event) {
    const image = event.target as HTMLImageElement;

    naturalWidth.value = image.naturalWidth;
    naturalHeight.value = image.naturalHeight;
    refreshPixel();
}

/**
 * Position a slice preview from pointer movement along a horizontal or
 * vertical selector.
 */
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

/**
 * Emit the selected source row or column for a new slice graph.
 */
function choose(event: MouseEvent, orientation: SliceOrientation) {
    // Keyboard activation synthesizes a click without pointer coordinates.
    if (event.detail !== 0) {
        preview(event, orientation);
    }

    if (selection.value?.orientation === orientation) {
        emit("slice", { ...selection.value });
    }
}

/**
 * Initialize a focused slice selector to the center of its source
 * dimension.
 */
function center(orientation: SliceOrientation) {
    const length =
        orientation === "horizontal" ? sourceHeight.value : sourceWidth.value;

    if (length > 0) {
        selection.value = { orientation, index: Math.floor(length / 2) };
    }
}

/**
 * Move or confirm a focused slice selection using keyboard navigation.
 */
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
    --axis-width: 0px;
    --axis-height: 0px;
    --slice-size: 0px;
    grid-template-columns: var(--axis-width) var(--slice-size) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) var(--slice-size) var(--axis-height);
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
}

.slice-image.enabled {
    --slice-size: 28px;
    background: #263b51;
}

.slice-image.axes-enabled {
    --axis-width: 78px;
    --axis-height: 50px;
}

.slice-viewport {
    position: relative;
    grid-column: 3;
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
    grid-column: 2;
    grid-row: 1;
}

.slice-strip-bottom {
    grid-column: 3;
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
