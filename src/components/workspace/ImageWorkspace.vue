<template>
    <section class="image-workspace" aria-label="Image workspace">
        <div class="workspace-stage">
            <FormationNavigator
                v-if="
                    formationSidebarOpen &&
                    formationSource?.formationProducts?.length
                "
                :products="formationSource.formationProducts"
                :selected="selectedFormationProduct"
                :name="formationSource.name"
                @close="formationSidebarOpen = false"
                @select="openFormationProduct" />
            <button
                v-if="
                    !formationSidebarOpen &&
                    formationSource?.formationProducts?.length
                "
                class="show-formation-sidebar"
                type="button"
                aria-label="Show formation products"
                title="Show formation products"
                @click="formationSidebarOpen = true">
                <q-icon name="chevron_right" size="20px" />
                <span>Formation products</span>
            </button>
            <div ref="canvas" class="image-canvas">
                <div v-if="!windows.length" class="canvas-empty">
                    <q-icon
                        :name="activeScenario ? 'image' : 'description'"
                        size="48px" />
                    <p v-if="!activeScenario">
                        Create or open a scenario from the File group to begin.
                    </p>
                    <p v-else>Open an image from the ribbon to begin.</p>
                </div>
                <ImageWidget
                    v-for="widget in windows"
                    :key="widget.id"
                    :widget="widget"
                    :active="activeId === widget.id"
                    :bounds="bounds"
                    @activate="activate(widget)"
                    @minimize="widget.minimized = true"
                    @close="close(widget)"
                    @toggle-maximize="toggleMaximize(widget)"
                    @move-start="startGesture($event, widget, 'move')"
                    @resize-start="
                        (event, edge) => startGesture(event, widget, edge)
                    "
                    @gesture-move="moveGesture"
                    @gesture-end="endGesture"
                    @move-key="moveWithKeyboard($event, widget)"
                    @resize-key="resizeWithKeyboard($event, widget)">
                    <div class="image-area">
                        <div class="widget-content">
                            <div
                                v-if="widget.loading"
                                class="column items-center q-gutter-md"
                                role="status"
                                aria-live="polite">
                                <q-spinner color="primary" size="40px" />
                                <span>
                                    {{
                                        widget.graph
                                            ? "Loading slice…"
                                            : "Loading image…"
                                    }}
                                </span>
                            </div>
                            <LineGraph
                                v-else-if="widget.graph?.data"
                                :data="widget.graph.data" />
                            <figure
                                v-else-if="diagnosticProduct(widget)"
                                class="diagnostic-slide"
                                aria-label="Intermediate product preview">
                                <img
                                    :src="
                                        diagnosticProduct(widget)!
                                            .previewDataUrl
                                    "
                                    :alt="diagnosticProduct(widget)!.title" />
                            </figure>
                            <ImageSliceView
                                v-else-if="widget.image.previewDataUrl"
                                :image="widget.image"
                                :enabled="
                                    !!widget.sliceEnabled && !widget.cropping
                                "
                                :inspect="
                                    !!widget.pixelValuesEnabled &&
                                    !widget.cropping
                                "
                                :axes="!!widget.axesEnabled"
                                :drawing="
                                    !!widget.polygonDrawing && !widget.cropping
                                "
                                :cropping="!!widget.cropping"
                                @crop="cropImage(widget, $event)"
                                @cancel-crop="widget.cropping = false"
                                :polygon="widget.region"
                                @region="selectRegion(widget, $event)"
                                @cancel-region="widget.polygonDrawing = false"
                                @slice="
                                    createSliceGraph(widget.image, $event)
                                " />
                            <p v-else>
                                {{
                                    widget.error ??
                                    "This plugin did not provide an image preview."
                                }}
                            </p>
                        </div>
                        <ImageStatisticsPanel
                            v-if="
                                widget.statisticsOpen &&
                                !diagnosticProduct(widget)
                            "
                            :widget="widget"
                            :statistics="displayStatistics(widget)"
                            :label="statisticsLabel(widget)"
                            @close="widget.statisticsOpen = false" />
                    </div>
                    <ImageMetadataPanel
                        v-if="widget.metadataOpen && !diagnosticProduct(widget)"
                        :widget="widget"
                        @close="widget.metadataOpen = false"
                        @select-axes="selectMetadataAxes(widget, $event)" />
                </ImageWidget>
            </div>
        </div>
        <div class="window-tray" aria-label="Minimized image windows">
            <q-btn
                v-for="widget in windows.filter(item => item.minimized)"
                :key="widget.id"
                flat
                dense
                no-caps
                icon="image"
                :label="widget.image.name"
                :title="`Restore ${widget.image.name}`"
                @click="restore(widget)" />
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import type {
    ImageContext,
    ImageWorkspaceAPI,
    RestoredImageWindow,
    SavedImageWindow
} from "@/types/workspace";
import {
    metadataAxesCandidates,
    resolveMetadataAxes
} from "@/utils/metadata-axes";
import type { PolygonPoint, RegionState } from "@/types/region";
import ImageWidget from "@/components/workspace/ImageWidget.vue";
import ImageMetadataPanel from "@/components/panels/ImageMetadataPanel.vue";
import ImageStatisticsPanel from "@/components/panels/ImageStatisticsPanel.vue";
import type { ImageWindow } from "@/types/image-window";
import type { MetadataAttachment } from "@/types/metadata";
import { useFormationProducts } from "@/composables/useFormationProducts";
import { previewRegionStatistics } from "@/utils/region-statistics";
import { useImageProcessing } from "@/composables/useImageProcessing";
import { useImageStatistics } from "@/composables/useImageStatistics";
import { useWidgetGestures } from "@/composables/useWidgetGestures";
import FormationNavigator from "@/components/workspace/FormationNavigator.vue";
import ImageSliceView from "@/components/image/ImageSliceView.vue";
import LineGraph from "@/components/charts/LineGraph.vue";
import { sliceAxes, slicePosition } from "@/utils/slice-axes";
import type { ScalingState } from "@/types/scaling";
import type { ImageInfo } from "@/types/image";
import { activeScenario } from "@/composables/useScenario";
import { fitWindow } from "@/utils/window-geometry.ts";

const canvas = ref<HTMLDivElement>();
const windows = ref<ImageWindow[]>([]);
const bounds = reactive({ width: 0, height: 0 });
const activeId = ref<number>();

const activeWidget = computed(() =>
    windows.value.find(
        widget => widget.id === activeId.value && !widget.minimized
    )
);

const {
    formationSidebarOpen,
    formationSource,
    selectedFormationProduct,
    pinFormationSource,
    openFormationProduct,
    productWindowImage,
    diagnosticProduct
} = useFormationProducts(windows, activeWidget, add, restore);

const {
    statisticsLabel,
    displayStatistics,
    initializePreviewStatistics,
    refreshRegion
} = useImageStatistics(windows);

const {
    startGesture,
    moveGesture,
    endGesture,
    moveWithKeyboard,
    resizeWithKeyboard,
    isGesturing
} = useWidgetGestures(canvas, windows, bounds, activate, () =>
    emit("change", snapshot())
);

const { cropImage, createSliceGraph, formSicd, createSidd, setScaling } =
    useImageProcessing({
        windows,
        activeWidget,
        add,
        complete,
        fail,
        refreshMetadataAxes,
        refreshRegion,
        diagnosticProduct,
        onError: message => emit("scalingError", message)
    });

/**
 * Toggle the active image metadata panel; graph windows do not expose
 * image metadata.
 */
function toggleMetadata() {
    if (activeWidget.value && !activeWidget.value.graph) {
        activeWidget.value.metadataOpen = !activeWidget.value.metadataOpen;
    }
}

/**
 * Resolve the selected coordinate source and update graphs associated with
 * this image.
 */
function refreshMetadataAxes(widget: ImageWindow) {
    widget.image = resolveMetadataAxes(widget.image, widget.metadataAxesSource);

    for (const item of windows.value) {
        if (item.graph?.sourceId === widget.id) {
            item.graph.source = widget.image;

            if (item.graph.rawData) {
                item.graph.data = sliceAxes(
                    item.graph.rawData,
                    widget.image,
                    item.graph.selection.orientation
                );
            }

            const { orientation, index } = item.graph.selection;

            item.image.name = `${orientation === "horizontal" ? "Horizontal" : "Vertical"} slice: ${widget.image.name} · ${slicePosition(widget.image, orientation, index)}`;
        }
    }
}

/**
 * Apply an embedded or attached coordinate source and enable its axis
 * display.
 */
function selectMetadataAxes(widget: ImageWindow, source: string) {
    if (
        source !== "embedded" &&
        !metadataAxesCandidates(widget.image).some(
            item => item.path === source && item.axes
        )
    ) {
        return;
    }

    widget.metadataAxesSource = source;
    refreshMetadataAxes(widget);
    widget.axesEnabled = true;
}

let attachingMetadata = false;

/**
 * Attach selected JSON files to the active image and resolve any
 * applicable axis definitions.
 */
async function attachMetadata() {
    const widget = activeWidget.value;

    if (!widget || widget.graph || widget.loading || attachingMetadata) {
        return;
    }

    attachingMetadata = true;

    try {
        const incoming = await window.images!.attachMetadata(widget.image.path);

        if (incoming) {
            const merged = [
                ...new Map(
                    [...(widget.image.attachedMetadata ?? []), ...incoming].map(
                        item => [item.path, item]
                    )
                ).values()
            ] as MetadataAttachment[];

            if (merged.length > 32) {
                throw new Error("Attach at most 32 metadata files per image.");
            }

            widget.image.attachedMetadata = merged;
            refreshMetadataAxes(widget);
            widget.metadataOpen = true;
        }
    } catch (cause) {
        emit(
            "metadataError",
            cause instanceof Error
                ? cause.message
                : "Unable to attach metadata."
        );
    } finally {
        attachingMetadata = false;
    }
}

/**
 * Toggle the active image statistics panel when whole-image or region
 * statistics are available.
 */
function toggleStatistics() {
    if (activeWidget.value && hasStatistics.value) {
        activeWidget.value.statisticsOpen = !activeWidget.value.statisticsOpen;
    }
}

const canSlice = computed(
    () =>
        !!activeWidget.value &&
        !activeWidget.value.loading &&
        !activeWidget.value.graph &&
        !diagnosticProduct(activeWidget.value) &&
        !!activeWidget.value.image.previewDataUrl
);

/**
 * Toggle the interactive slice selectors on the active image.
 */
function toggleSlice() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.sliceEnabled = !activeWidget.value.sliceEnabled;
    }
}

/**
 * Toggle rectangular crop selection and leave polygon drawing mode.
 */
function toggleCrop() {
    const widget = activeWidget.value;

    if (canSlice.value && widget?.image.supportsCrop) {
        widget.cropping = !widget.cropping;
        widget.polygonDrawing = false;
    }
}

/**
 * Toggle polygon drawing and leave rectangular crop mode.
 */
function togglePolygon() {
    const widget = activeWidget.value;

    if (canSlice.value && widget) {
        widget.cropping = false;
        widget.polygonDrawing = !widget.polygonDrawing;
    }
}

/**
 * Store a closed source-pixel polygon and begin computing statistics
 * inside it.
 */
function selectRegion(widget: ImageWindow, polygon: PolygonPoint[]) {
    widget.region = polygon;
    widget.polygonDrawing = false;
    widget.statisticsOpen = true;
    void refreshRegion(widget);
}

/**
 * Invalidate pending region reads and restore the whole-image statistics
 * view.
 */
async function clearRegion() {
    const widget = activeWidget.value;

    if (!widget || widget.graph) {
        return;
    }

    widget.polygonDrawing = false;
    widget.regionVersion = (widget.regionVersion ?? 0) + 1;
    delete widget.region;
    delete widget.regionResult;
    delete widget.regionError;
    widget.regionBusy = false;

    if (
        !widget.image.statistics &&
        !widget.previewWholeStatistics &&
        !widget.wholeStatisticsBusy &&
        widget.image.previewDataUrl
    ) {
        const version = widget.regionVersion;

        widget.regionBusy = true;

        try {
            const result = await previewRegionStatistics(widget.image);

            if (widget.regionVersion === version) {
                widget.previewWholeStatistics = result.statistics;
            }
        } catch (cause) {
            if (widget.regionVersion === version) {
                widget.regionError =
                    cause instanceof Error
                        ? cause.message
                        : "Unable to read preview statistics.";
            }
        } finally {
            if (widget.regionVersion === version) {
                widget.regionBusy = false;
            }
        }
    }
}

/**
 * Toggle physical or pixel-coordinate axes on the active image.
 */
function toggleAxes() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.axesEnabled = !activeWidget.value.axesEnabled;
    }
}

/**
 * Toggle source-pixel inspection for pointer movement over the active
 * image.
 */
function togglePixelValues() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.pixelValuesEnabled =
            !activeWidget.value.pixelValuesEnabled;
    }
}

let sequence = 0;
let zIndex = 0;

/**
 * Bring a window to the front without changing the pinned formation
 * navigator.
 */
function activate(widget: ImageWindow) {
    if (activeId.value !== widget.id) {
        widget.z = ++zIndex;
        activeId.value = widget.id;
    }
}

/**
 * Create and activate an image widget; return its session-local window
 * identifier.
 */
function add(image: ImageInfo, loading = false) {
    const position = (windows.value.length % 8) * 28 + 16;
    const widget: ImageWindow = {
        id: ++sequence,
        image: resolveMetadataAxes(image),
        loading,
        rect: fitWindow(
            { x: position, y: position, width: 520, height: 360 },
            bounds
        ),
        minimized: false,
        maximized: false,
        z: ++zIndex
    };

    windows.value.push(widget);
    void initializePreviewStatistics(
        windows.value.find(item => item.id === widget.id)!
    );
    activeId.value = widget.id;

    return widget.id;
}

/**
 * Populate a loading widget and refresh its statistics, axes, and product
 * state.
 *
 * @param id - Session-local widget identifier returned by add.
 * @param image - Completed reader output; ignored if the widget was closed
 * while loading.
 */
function complete(id: number, image: ImageInfo) {
    const widget = windows.value.find(item => item.id === id);

    if (!widget) {
        return;
    }

    widget.image = productWindowImage(
        resolveMetadataAxes(image, widget.metadataAxesSource),
        widget.formationProductId
    );

    if (!formationSource.value || widget.id === activeId.value) {
        pinFormationSource(image);

        if (widget.id === activeId.value && image.formationProducts?.length) {
            selectedFormationProduct.value =
                widget.formationProductId ?? "final";
        }
    }

    widget.loading = false;
    void initializePreviewStatistics(widget);

    if (widget.region) {
        void refreshRegion(widget);
    }
}

/**
 * End loading and retain an error message on the existing widget.
 */
function fail(id: number, message: string) {
    const widget = windows.value.find(item => item.id === id);

    if (!widget) {
        return;
    }

    widget.loading = false;
    widget.error = message;
    widget.image.pluginName = "Failed to load";
}

/**
 * Serialize persistent image and diagnostic windows for the scenario.
 *
 * @returns Detached geometry, source paths, and analysis selections.
 * Transient graphs and unfinished loading placeholders are excluded.
 */
function snapshot(): SavedImageWindow[] {
    return windows.value
        .filter(widget => widget.image.pluginId && !widget.graph)
        .map(widget => ({
            id: widget.id,
            ...(widget.formationProductId
                ? { formationProductId: widget.formationProductId }
                : {}),
            ...(widget.region
                ? { region: widget.region.map(point => ({ ...point })) }
                : {}),
            ...(widget.metadataAxesSource !== undefined
                ? { metadataAxesSource: widget.metadataAxesSource }
                : {}),
            ...(widget.image.scaling ? { scaling: widget.image.scaling } : {}),
            ...(widget.image.attachedMetadata?.length
                ? {
                      metadataFiles: widget.image.attachedMetadata.map(
                          item => item.path
                      )
                  }
                : {}),
            path: widget.image.path,
            pluginId: widget.image.pluginId,
            rect: { ...widget.rect },
            minimized: widget.minimized,
            maximized: widget.maximized,
            z: widget.z
        }));
}

/**
 * Restore saved widget geometry and selections, then initialize statistics
 * and formation navigation.
 */
function hydrate(saved: RestoredImageWindow[]) {
    formationSource.value = undefined;
    windows.value = saved.map(widget => ({
        id: widget.id,
        image: productWindowImage(
            resolveMetadataAxes(widget.image, widget.metadataAxesSource),
            widget.formationProductId
        ),
        ...(widget.formationProductId
            ? { formationProductId: widget.formationProductId }
            : {}),
        ...(widget.metadataAxesSource !== undefined
            ? { metadataAxesSource: widget.metadataAxesSource }
            : {}),
        ...(widget.region
            ? {
                  region: widget.region.map(point => ({ ...point })),
                  statisticsOpen: true
              }
            : {}),
        loading: widget.loading ?? false,
        rect: fitWindow(widget.rect, bounds),
        minimized: widget.minimized,
        maximized: widget.maximized,
        z: widget.z,
        ...(widget.error ? { error: widget.error } : {})
    }));
    sequence = Math.max(0, ...saved.map(widget => widget.id));
    zIndex = Math.max(0, ...saved.map(widget => widget.z));
    activeId.value = windows.value.find(widget => widget.z === zIndex)?.id;

    const restoredFormation = [...windows.value]
        .reverse()
        .find(widget => widget.image.formationProducts?.length);

    if (restoredFormation) {
        pinFormationSource(restoredFormation.image);
        selectedFormationProduct.value =
            restoredFormation.formationProductId ?? "final";
    }

    for (const widget of windows.value) {
        void initializePreviewStatistics(widget);

        if (widget.region && !widget.loading) {
            void refreshRegion(widget);
        }
    }
}

const emit = defineEmits<{
    change: [windows: SavedImageWindow[]];

    activeChange: [available: boolean];

    imageContextChange: [context: ImageContext];

    regionChange: [state: RegionState];

    cropChange: [
        state: {
            available: boolean;

            active: boolean;
        }
    ];

    statisticsChange: [available: boolean];

    sliceChange: [available: boolean];

    sliceModeChange: [enabled: boolean];

    pixelValuesChange: [enabled: boolean];

    axesChange: [enabled: boolean];

    scalingChange: [state: ScalingState];

    scalingError: [message: string];

    metadataError: [message: string];
}>();

watch(
    () => ({
        available: canSlice.value && !!activeWidget.value?.image.supportsCrop,
        active: !!activeWidget.value?.cropping
    }),
    state => emit("cropChange", state),
    { immediate: true }
);
watch(
    () => ({
        available: canSlice.value,
        drawing: !!activeWidget.value?.polygonDrawing,
        selected: !!activeWidget.value?.region
    }),
    state => emit("regionChange", state),
    { immediate: true }
);
watch(
    () => {
        const widget = activeWidget.value;
        const source = widget?.graph?.source ?? widget?.image;

        return {
            available: !!widget,
            scientific: source?.pluginId === "nova.sicd",
            canCreateSidd:
                !!widget &&
                !widget.graph &&
                !widget.loading &&
                !diagnosticProduct(widget) &&
                source?.pluginId === "nova.sicd" &&
                source.metadata?.Format === "SICD / NITF",
            canFormSicd:
                !!widget &&
                !widget.graph &&
                !widget.loading &&
                source?.pluginId === "nova.sicd" &&
                source.metadata?.Format === "CPHD"
        };
    },
    context => emit("imageContextChange", context),
    { immediate: true }
);
watch(
    () =>
        ({
            options:
                activeWidget.value && diagnosticProduct(activeWidget.value)
                    ? []
                    : (activeWidget.value?.image.scalingOptions ?? []),
            value: activeWidget.value?.image.scaling ?? "amplitude",
            loading: !!activeWidget.value?.loading
        }) as ScalingState,
    state => emit("scalingChange", state),
    { immediate: true, deep: true }
);
watch(
    () => !!activeWidget.value?.axesEnabled,
    enabled => emit("axesChange", enabled),
    { immediate: true }
);
watch(
    () => !!activeWidget.value?.pixelValuesEnabled,
    enabled => emit("pixelValuesChange", enabled),
    { immediate: true }
);
watch(
    () => !!activeWidget.value?.sliceEnabled,
    enabled => emit("sliceModeChange", enabled),
    { immediate: true }
);
watch(canSlice, available => emit("sliceChange", available), {
    immediate: true
});

const hasStatistics = computed(() => {
    const widget = activeWidget.value;

    return (
        !!widget &&
        !widget.graph &&
        !widget.loading &&
        !diagnosticProduct(widget) &&
        (!!widget.region ||
            !!widget.wholeStatisticsBusy ||
            !!widget.previewStatisticsError ||
            (!!displayStatistics(widget) &&
                Object.keys(displayStatistics(widget)!).length > 0))
    );
});

watch(hasStatistics, available => emit("statisticsChange", available), {
    immediate: true
});
watch(
    () =>
        !!activeWidget.value &&
        !activeWidget.value.graph &&
        !diagnosticProduct(activeWidget.value),
    available => emit("activeChange", available),
    {
        immediate: true
    }
);
watch(
    snapshot,
    value => {
        if (!isGesturing()) {
            emit("change", value);
        }
    },
    { deep: true }
);
defineExpose({
    add,
    complete,
    fail,
    hydrate,
    snapshot,
    toggleMetadata,
    attachMetadata,
    toggleStatistics,
    toggleSlice,
    togglePixelValues,
    toggleAxes,
    toggleCrop,
    togglePolygon,
    clearRegion,
    setScaling,
    formSicd,
    createSidd
} satisfies ImageWorkspaceAPI);

/**
 * Toggle a widget between its saved rectangle and the workspace canvas
 * bounds.
 */
function toggleMaximize(widget: ImageWindow) {
    widget.maximized = !widget.maximized;
    activate(widget);
}

/**
 * Unminimize a widget and bring it to the front.
 */
function restore(widget: ImageWindow) {
    widget.minimized = false;
    activate(widget);
}

/**
 * Remove the widget while retaining independently pinned formation
 * products.
 */
function close(widget: ImageWindow) {
    windows.value = windows.value.filter(item => item.id !== widget.id);
}
</script>

<style scoped>
.image-workspace {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
}

.show-formation-sidebar {
    flex: 0 0 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 4px;
    writing-mode: vertical-rl;
    background: #f6f8fa;
    color: #243447;
    border: 0;
    border-right: 1px solid #ccd4de;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
}

.show-formation-sidebar:hover {
    background: #eaf3fc;
}

.show-formation-sidebar:focus-visible {
    outline: 2px solid #1976d2;
    outline-offset: -2px;
}

.workspace-stage {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
}

.diagnostic-slide {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 10px;
    color: #e2e8f0;
}

.diagnostic-slide img {
    flex: 1;
    min-height: 0;
    width: 100%;
    object-fit: contain;
}

.image-canvas {
    min-width: 0;
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    isolation: isolate;
    background: #e9eef4;
}

.canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    color: #748398;
    pointer-events: none;
}

.image-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
}

.widget-content {
    min-width: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    background: #111b27;
    color: #c8d3df;
}

.widget-content img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.widget-content p {
    padding: 16px;
}

.window-tray {
    display: flex;
    gap: 4px;
    align-items: center;
    height: 36px;
    flex-shrink: 0;
    overflow-x: auto;
    background: #dce4ee;
    padding: 0 8px;
}

.window-tray :deep(.q-btn) {
    max-width: 200px;
    flex-shrink: 0;
}

.window-tray :deep(.q-btn__content) {
    flex-wrap: nowrap;
    overflow: hidden;
    white-space: nowrap;
}
</style>
