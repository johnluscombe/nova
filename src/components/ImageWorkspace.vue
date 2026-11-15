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
                <article
                    v-for="widget in windows"
                    v-show="!widget.minimized"
                    :key="widget.id"
                    class="image-window"
                    :class="{ active: activeId === widget.id }"
                    :style="windowStyle(widget)"
                    :aria-label="widget.image.name"
                    @pointerdown="activate(widget)"
                    @focusin="activate(widget)">
                    <div
                        class="widget-titlebar"
                        tabindex="0"
                        :aria-label="`${widget.image.name} window title. Use arrow keys to move.`"
                        @pointerdown="startGesture($event, widget, 'move')"
                        @pointermove="moveGesture"
                        @pointerup="endGesture"
                        @pointercancel="endGesture"
                        @lostpointercapture="endGesture"
                        @dblclick="toggleMaximize(widget)"
                        @keydown="moveWithKeyboard($event, widget)">
                        <q-icon name="image" size="16px" />
                        <span class="widget-title" :title="widget.image.path">
                            {{ widget.image.name }}
                        </span>
                        <div
                            class="widget-controls"
                            @pointerdown.stop
                            @dblclick.stop
                            @keydown.stop>
                            <q-btn
                                flat
                                dense
                                icon="remove"
                                :aria-label="`Minimize ${widget.image.name}`"
                                title="Minimize"
                                @click="widget.minimized = true" />
                            <q-btn
                                flat
                                dense
                                :icon="
                                    widget.maximized
                                        ? 'filter_none'
                                        : 'crop_square'
                                "
                                :aria-label="`${widget.maximized ? 'Restore' : 'Maximize'} ${widget.image.name}`"
                                :title="
                                    widget.maximized ? 'Restore' : 'Maximize'
                                "
                                @click="toggleMaximize(widget)" />
                            <q-btn
                                flat
                                dense
                                icon="close"
                                class="widget-close"
                                :aria-label="`Close ${widget.image.name}`"
                                title="Close"
                                @click="close(widget)" />
                        </div>
                    </div>
                    <div class="widget-body">
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
                                        :alt="
                                            diagnosticProduct(widget)!.title
                                        " />
                                </figure>
                                <ImageSliceView
                                    v-else-if="widget.image.previewDataUrl"
                                    :image="widget.image"
                                    :enabled="!!widget.sliceEnabled"
                                    :inspect="!!widget.pixelValuesEnabled"
                                    :axes="!!widget.axesEnabled"
                                    :drawing="!!widget.polygonDrawing"
                                    :polygon="widget.region"
                                    @region="selectRegion(widget, $event)"
                                    @cancel-region="
                                        widget.polygonDrawing = false
                                    "
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
                            <section
                                v-if="
                                    widget.statisticsOpen &&
                                    !diagnosticProduct(widget)
                                "
                                class="statistics-panel"
                                aria-label="Image statistics">
                                <div class="row items-center justify-between">
                                    <strong>
                                        {{
                                            widget.region
                                                ? "Region statistics"
                                                : "Statistics"
                                        }}
                                    </strong>
                                    <q-btn
                                        flat
                                        dense
                                        round
                                        icon="close"
                                        aria-label="Close statistics"
                                        @click="
                                            widget.statisticsOpen = false
                                        " />
                                </div>
                                <p
                                    v-if="
                                        widget.loading ||
                                        widget.regionBusy ||
                                        (!widget.region &&
                                            widget.wholeStatisticsBusy)
                                    "
                                    role="status">
                                    Loading statistics…
                                </p>
                                <template v-else>
                                    <p v-if="widget.regionResult">
                                        {{ widget.regionResult.valueLabel }} ·
                                        {{ widget.regionResult.sampleCount }}
                                        finite samples{{
                                            widget.regionResult.sampled
                                                ? " (sampled)"
                                                : ""
                                        }}
                                    </p>
                                    <p
                                        v-if="
                                            widget.regionResult?.sampleCount ===
                                            0
                                        ">
                                        No finite pixel samples fall inside this
                                        region.
                                    </p>
                                    <p
                                        v-if="
                                            !widget.region &&
                                            statisticsLabel(widget)
                                        ">
                                        {{ statisticsLabel(widget) }}
                                    </p>
                                    <dl
                                        v-if="
                                            displayStatistics(widget) &&
                                            Object.keys(
                                                visibleStatistics(
                                                    displayStatistics(widget)
                                                )
                                            ).length
                                        ">
                                        <div
                                            v-for="(
                                                value, label
                                            ) in visibleStatistics(
                                                displayStatistics(widget)
                                            )"
                                            :key="label">
                                            <dt>{{ label }}</dt>
                                            <dd>
                                                {{
                                                    typeof value === "number"
                                                        ? Number(
                                                              value.toPrecision(
                                                                  7
                                                              )
                                                          )
                                                        : (value ??
                                                          "Not available")
                                                }}
                                            </dd>
                                        </div>
                                    </dl>
                                    <p v-else>
                                        {{
                                            widget.regionError ??
                                            widget.previewStatisticsError ??
                                            widget.error ??
                                            (Object.keys(
                                                displayStatistics(widget)
                                            ).length
                                                ? "The selected percentiles are not available for this image."
                                                : "This plugin does not provide image statistics.")
                                        }}
                                    </p>
                                </template>
                            </section>
                        </div>
                        <aside
                            v-if="
                                widget.metadataOpen &&
                                !diagnosticProduct(widget)
                            "
                            class="metadata-panel"
                            aria-label="Image metadata">
                            <div class="row items-center justify-between">
                                <strong>Metadata</strong>
                                <q-btn
                                    flat
                                    dense
                                    round
                                    icon="close"
                                    aria-label="Close metadata"
                                    @click="widget.metadataOpen = false" />
                            </div>
                            <p v-if="widget.loading" role="status">
                                Loading metadata…
                            </p>
                            <dl>
                                <template
                                    v-for="(
                                        [label, value], index
                                    ) in metadataEntries(widget)"
                                    :key="index">
                                    <dt>{{ label }}</dt>
                                    <dd>
                                        {{
                                            typeof value === "number"
                                                ? Number(value.toPrecision(7))
                                                : (value ?? "Not available")
                                        }}
                                    </dd>
                                </template>
                            </dl>
                            <AttachedMetadata
                                :attachments="
                                    widget.image.attachedMetadata ?? []
                                "
                                :candidates="
                                    metadataAxesCandidates(widget.image)
                                "
                                :axes-source="
                                    widget.image.axesSource ?? 'pixel'
                                "
                                :has-embedded-axes="!!widget.image.embeddedAxes"
                                :notice="widget.image.axesNotice"
                                :axes-preference="widget.metadataAxesSource"
                                @select-axes="
                                    selectMetadataAxes(widget, $event)
                                " />
                        </aside>
                    </div>
                    <div class="widget-status" :title="widget.image.path">
                        {{ widget.image.pluginName }}
                        <span v-if="widget.image.width && widget.image.height">
                            · {{ widget.image.width }} ×
                            {{ widget.image.height }}
                        </span>
                    </div>
                    <template v-if="!widget.maximized">
                        <div
                            v-for="edge in edges"
                            :key="edge"
                            class="resize-handle"
                            :class="`resize-${edge}`"
                            @pointerdown.stop="
                                startGesture($event, widget, edge)
                            "
                            @pointermove="moveGesture"
                            @pointerup="endGesture"
                            @pointercancel="endGesture"
                            @lostpointercapture="endGesture" />
                        <button
                            class="resize-keyboard"
                            :aria-label="`Resize ${widget.image.name} with arrow keys`"
                            @keydown="resizeWithKeyboard($event, widget)">
                            ⌟
                        </button>
                    </template>
                </article>
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
import {
    onBeforeUnmount,
    onMounted,
    ref,
    reactive,
    watch,
    computed
} from "vue";
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
import { previewRegionStatistics } from "@/utils/region-statistics";
import type {
    PolygonPoint,
    RegionStatistics,
    RegionState
} from "@/types/region";
import AttachedMetadata from "./AttachedMetadata.vue";
import type { MetadataAttachment } from "@/types/metadata";
import FormationNavigator from "./FormationNavigator.vue";
import ImageSliceView from "./ImageSliceView.vue";
import LineGraph from "./LineGraph.vue";
import { sliceAxes, slicePosition } from "@/utils/slice-axes";
import { previewSlice } from "@/utils/image-slice";
import { formationSettings } from "@/composables/useSettings";
import type { Scaling, ScalingState } from "@/types/scaling";
import type { SliceData, SliceSelection } from "@/types/slice";
import type { ImageInfo } from "@/types/image";
import { visibleStatistics } from "@/composables/useSettings";
import { activeScenario } from "@/composables/useScenario";
import {
    fitWindow,
    resizeWindow,
    type WindowRect
} from "../utils/window-geometry.ts";
const formationSidebarOpen = ref(true);
const formationSource = ref<ImageInfo>();
const selectedFormationProduct = ref("final");
interface ImageWindow {
    id: number;
    image: ImageInfo;
    rect: WindowRect;
    minimized: boolean;
    maximized: boolean;
    z: number;
    error?: string;
    loading?: boolean;
    metadataOpen?: boolean;
    statisticsOpen?: boolean;
    sliceEnabled?: boolean;
    pixelValuesEnabled?: boolean;
    axesEnabled?: boolean;
    polygonDrawing?: boolean;
    region?: PolygonPoint[];
    regionResult?: RegionStatistics;
    regionBusy?: boolean;
    regionError?: string;
    regionVersion?: number;
    previewWholeStatistics?: Record<string, number | null>;
    previewWholeSampled?: boolean;
    wholeStatisticsBusy?: boolean;
    previewStatisticsError?: string;
    formationProductId?: string;
    metadataAxesSource?: string;
    graph?: {
        data?: SliceData;
        rawData?: SliceData;
        source: ImageInfo;
        sourceId?: number | undefined;
        selection: SliceSelection;
    };
}
const activeWidget = computed(() =>
    windows.value.find(
        widget => widget.id === activeId.value && !widget.minimized
    )
);
function pinFormationSource(image: ImageInfo) {
    if (!image.formationProducts?.length) {
        return;
    }
    if (formationSource.value?.path !== image.path) {
        selectedFormationProduct.value = "final";
    }
    formationSource.value = {
        ...image,
        name: image.path.split(/[\\/]/).pop() || image.name
    };
}
function openFormationProduct(id: string) {
    const source = formationSource.value;
    const product = source?.formationProducts?.find(item => item.id === id);
    if (!source || !product) {
        return;
    }
    selectedFormationProduct.value = id;
    const existing = windows.value.find(
        widget =>
            !widget.graph &&
            widget.image.path === source.path &&
            (id === "final"
                ? !widget.formationProductId ||
                  widget.formationProductId === "final"
                : widget.formationProductId === id)
    );
    if (existing) {
        restore(existing);
        return;
    }
    const windowId = add({ ...source });
    const widget = windows.value.find(item => item.id === windowId)!;
    if (id !== "final") {
        widget.formationProductId = id;
        widget.image.name = `${product.title} · ${source.name}`;
    }
}
function productWindowImage(image: ImageInfo, id?: string): ImageInfo {
    const product = image.formationProducts?.find(
        item => item.id === id && id !== "final"
    );
    return product
        ? {
              ...image,
              name: `${product.title} · ${image.path.split(/[\\/]/).pop() || image.name}`
          }
        : image;
}
function diagnosticProduct(widget: ImageWindow) {
    return widget.image.formationProducts?.find(
        product =>
            product.id === widget.formationProductId && product.id !== "final"
    );
}
function toggleMetadata() {
    if (activeWidget.value && !activeWidget.value.graph) {
        activeWidget.value.metadataOpen = !activeWidget.value.metadataOpen;
    }
}
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
function toggleSlice() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.sliceEnabled = !activeWidget.value.sliceEnabled;
    }
}
function statisticsLabel(widget: ImageWindow) {
    return (
        widget.image.metadata?.Scaling ??
        widget.image.metadata?.["Statistics quantity"] ??
        (widget.previewWholeStatistics
            ? `Preview luminance (0–255)${widget.previewWholeSampled ? " (sampled)" : ""}`
            : undefined)
    );
}
function displayStatistics(
    widget: ImageWindow
): Record<string, string | number | boolean | null> {
    return (
        (widget.region
            ? widget.regionResult?.statistics
            : (widget.image.statistics ?? widget.previewWholeStatistics)) ?? {}
    );
}

async function initializePreviewStatistics(widget: ImageWindow) {
    const image = widget.image;
    if (
        widget.loading ||
        !!widget.region ||
        !["nova.raster", "nova.vector"].includes(image.pluginId) ||
        !image.previewDataUrl ||
        image.statistics ||
        widget.previewWholeStatistics ||
        widget.wholeStatisticsBusy
    ) {
        return;
    }
    widget.wholeStatisticsBusy = true;
    delete widget.previewStatisticsError;
    try {
        const result = await previewRegionStatistics(image);
        if (
            windows.value.includes(widget) &&
            widget.image.previewDataUrl === image.previewDataUrl
        ) {
            widget.previewWholeStatistics = result.statistics;
            widget.previewWholeSampled = result.sampled;
        }
    } catch (cause) {
        if (windows.value.includes(widget)) {
            widget.previewStatisticsError =
                cause instanceof Error
                    ? cause.message
                    : "Unable to calculate raster statistics.";
        }
    } finally {
        widget.wholeStatisticsBusy = false;
    }
}
async function refreshRegion(widget: ImageWindow) {
    if (!widget.region) {
        return;
    }
    const version = (widget.regionVersion ?? 0) + 1;
    widget.regionVersion = version;
    widget.regionBusy = true;
    delete widget.regionResult;
    delete widget.regionError;
    try {
        const result = widget.image.supportsSourceRegions
            ? await window.images!.region(
                  widget.image.path,
                  widget.image.pluginId,
                  widget.region.map(point => ({
                      row: point.row,
                      column: point.column
                  })),
                  widget.image.scaling
              )
            : await previewRegionStatistics(widget.image, widget.region);
        if (
            widget.regionVersion === version &&
            windows.value.includes(widget)
        ) {
            widget.regionResult = result;
            if (result.wholeImageStatistics) {
                widget.previewWholeStatistics = result.wholeImageStatistics;
                widget.previewWholeSampled = result.sampled;
            }
        }
    } catch (cause) {
        if (widget.regionVersion === version) {
            widget.regionError =
                cause instanceof Error
                    ? cause.message
                    : "Unable to calculate region statistics.";
        }
    } finally {
        if (widget.regionVersion === version) {
            widget.regionBusy = false;
        }
    }
}
function togglePolygon() {
    const widget = activeWidget.value;
    if (canSlice.value && widget) {
        widget.polygonDrawing = !widget.polygonDrawing;
    }
}
function selectRegion(widget: ImageWindow, polygon: PolygonPoint[]) {
    widget.region = polygon;
    widget.polygonDrawing = false;
    widget.statisticsOpen = true;
    void refreshRegion(widget);
}
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
function toggleAxes() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.axesEnabled = !activeWidget.value.axesEnabled;
    }
}
function togglePixelValues() {
    if (canSlice.value && activeWidget.value) {
        activeWidget.value.pixelValuesEnabled =
            !activeWidget.value.pixelValuesEnabled;
    }
}
async function createSliceGraph(
    source: ImageInfo,
    { orientation, index }: SliceSelection
) {
    const title = `${orientation === "horizontal" ? "Horizontal" : "Vertical"} slice: ${source.name} · ${slicePosition(source, orientation, index)}`;
    const id = add(
        {
            name: title,
            path: source.path,
            pluginId: "",
            pluginName: "Slice graph",
            ...(source.scalingOptions
                ? {
                      scalingOptions: source.scalingOptions,
                      scaling: source.scaling
                  }
                : {})
        },
        true
    );
    windows.value.find(widget => widget.id === id)!.graph = {
        source,
        sourceId: windows.value.find(item => item.image === source)?.id,
        selection: { orientation, index }
    };
    try {
        const data = source.supportsSourceSlices
            ? await window.images!.slice(
                  source.path,
                  source.pluginId,
                  orientation,
                  index,
                  source.scaling
              )
            : await previewSlice(source, orientation, index);
        const widget = windows.value.find(widget => widget.id === id);
        if (widget?.graph) {
            widget.graph.rawData = data;
            widget.graph.data = sliceAxes(
                data,
                widget.graph.source,
                orientation
            );
            widget.loading = false;
        }
    } catch (cause) {
        fail(
            id,
            cause instanceof Error
                ? cause.message
                : "Unable to read image slice."
        );
    }
}

async function formSicd() {
    const widget = activeWidget.value;
    if (
        !widget ||
        widget.loading ||
        widget.graph ||
        widget.image.metadata?.Format !== "CPHD"
    ) {
        return;
    }
    const source = widget.image;
    const id = add(
        {
            name: `${source.name} — forming SICD`,
            path: "",
            pluginId: "",
            pluginName: "Scientific Imagery"
        },
        true
    );
    try {
        const result = await window.images!.formSicd(
            source.path,
            source.pluginId,
            { ...formationSettings.value }
        );
        complete(id, result);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        fail(id, message);
        emit("scalingError", message);
    }
}

async function setScaling(scaling: Scaling) {
    const widget = activeWidget.value;
    if (
        !widget ||
        widget.loading ||
        !widget.image.scalingOptions?.includes(scaling) ||
        widget.image.scaling === scaling
    ) {
        return;
    }
    widget.loading = true;
    try {
        if (widget.graph) {
            const { source, selection } = widget.graph;
            const data = await window.images!.slice(
                source.path,
                source.pluginId,
                selection.orientation,
                selection.index,
                scaling
            );
            widget.graph.rawData = data;
            widget.graph.data = sliceAxes(
                data,
                widget.graph.source,
                selection.orientation
            );
            widget.image.scaling = scaling;
        } else {
            const image = await window.images!.rescale(
                widget.image.path,
                widget.image.pluginId,
                scaling
            );
            if (widget.image.attachedMetadata) {
                image.attachedMetadata = widget.image.attachedMetadata;
            }
            widget.image = image;
            refreshMetadataAxes(widget);
            if (widget.region) {
                void refreshRegion(widget);
            }
        }
        delete widget.error;
    } catch (cause) {
        emit(
            "scalingError",
            cause instanceof Error ? cause.message : "Unable to change scaling."
        );
    } finally {
        widget.loading = false;
    }
}

function metadataEntries(widget: ImageWindow) {
    return [
        ["Name", widget.image.name],
        ["Path", widget.image.path],
        ["Reader", widget.image.pluginName],
        ["Width", widget.image.width],
        ["Height", widget.image.height],
        ...Object.entries(widget.image.metadata ?? {})
    ];
}
const canvas = ref<HTMLDivElement>();
const windows = ref<ImageWindow[]>([]);
const bounds = reactive({ width: 0, height: 0 });
const activeId = ref<number>();
const edges = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
let sequence = 0;
let zIndex = 0;
let observer: ResizeObserver | undefined;
let gesture:
    | {
          widget: ImageWindow;
          pointerId: number;
          x: number;
          y: number;
          rect: WindowRect;
          action: string;
      }
    | undefined;
function activate(widget: ImageWindow) {
    if (activeId.value !== widget.id) {
        widget.z = ++zIndex;
        activeId.value = widget.id;
    }
}
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
function fail(id: number, message: string) {
    const widget = windows.value.find(item => item.id === id);
    if (!widget) {
        return;
    }
    widget.loading = false;
    widget.error = message;
    widget.image.pluginName = "Failed to load";
}
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
watch(
    () => activeWidget.value?.image,
    image => {
        if (image) {
            pinFormationSource(image);
        }
    }
);
const emit = defineEmits<{
    change: [windows: SavedImageWindow[]];
    activeChange: [available: boolean];
    imageContextChange: [context: ImageContext];
    regionChange: [state: RegionState];
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
        if (!gesture) {
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
    togglePolygon,
    clearRegion,
    setScaling,
    formSicd
} satisfies ImageWorkspaceAPI);
function windowStyle(widget: ImageWindow) {
    const rect = widget.maximized ? { x: 0, y: 0, ...bounds } : widget.rect;
    return {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: widget.z
    };
}
function toggleMaximize(widget: ImageWindow) {
    widget.maximized = !widget.maximized;
    activate(widget);
}
function restore(widget: ImageWindow) {
    widget.minimized = false;
    activate(widget);
}
function close(widget: ImageWindow) {
    windows.value = windows.value.filter(item => item.id !== widget.id);
}
function startGesture(
    event: PointerEvent,
    widget: ImageWindow,
    action: string
) {
    if (event.button !== 0 || widget.maximized) {
        return;
    }
    event.preventDefault();
    activate(widget);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    gesture = {
        widget,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rect: { ...widget.rect },
        action
    };
}
function moveGesture(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
    }
    const { widget, rect, action, x, y } = gesture;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    widget.rect =
        action === "move"
            ? fitWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds)
            : resizeWindow(rect, action, dx, dy, bounds);
}
function endGesture() {
    if (gesture) {
        gesture = undefined;
        emit("change", snapshot());
    }
}
function keyboardDelta(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    return {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
    }[event.key];
}
function moveWithKeyboard(event: KeyboardEvent, widget: ImageWindow) {
    const delta = keyboardDelta(event);
    if (!delta || widget.maximized) {
        return;
    }
    event.preventDefault();
    widget.rect = fitWindow(
        {
            ...widget.rect,
            x: widget.rect.x + delta[0]!,
            y: widget.rect.y + delta[1]!
        },
        bounds
    );
}
function resizeWithKeyboard(event: KeyboardEvent, widget: ImageWindow) {
    const delta = keyboardDelta(event);
    if (!delta) {
        return;
    }
    event.preventDefault();
    widget.rect = resizeWindow(widget.rect, "se", delta[0]!, delta[1]!, bounds);
}
onMounted(() => {
    observer = new ResizeObserver(entries => {
        const size = entries[0]?.contentRect;
        if (!size) {
            return;
        }
        bounds.width = size.width;
        bounds.height = size.height;
        endGesture();
        for (const widget of windows.value) {
            widget.rect = fitWindow(widget.rect, bounds);
        }
    });
    if (canvas.value) {
        bounds.width = canvas.value.clientWidth;
        bounds.height = canvas.value.clientHeight;
        observer.observe(canvas.value);
    }
});
onBeforeUnmount(() => {
    observer?.disconnect();
    endGesture();
});
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
.image-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #a9b7c7;
    border-radius: 6px;
    background: white;
    box-shadow: 0 3px 12px #20375426;
}
.image-window.active {
    border-color: #3979b9;
    box-shadow: 0 4px 18px #20375440;
}
.widget-titlebar {
    display: flex;
    gap: 8px;
    align-items: center;
    height: 32px;
    flex-shrink: 0;
    padding-left: 10px;
    background: #e2e9f1;
    color: #284663;
    cursor: move;
    touch-action: none;
    user-select: none;
}
.active .widget-titlebar {
    background: #234c78;
    color: white;
}
.widget-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}
.widget-controls {
    display: flex;
    height: 100%;
    cursor: default;
}
.widget-controls :deep(.q-btn) {
    width: 32px;
    min-height: 0;
    border-radius: 0;
}
.widget-controls :deep(.q-icon) {
    font-size: 16px;
}
.widget-close:hover {
    background: #c42b1c;
    color: white;
}
.image-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
}
.statistics-panel {
    flex-shrink: 0;
    max-height: 45%;
    overflow: auto;
    padding: 8px 12px;
    background: #f6f8fa;
    color: #243447;
    border-top: 1px solid #ccd4de;
    font-size: 12px;
}
.statistics-panel dl {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin: 4px 0;
}
.statistics-panel dt {
    font-weight: 600;
}
.statistics-panel dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
}
.widget-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.metadata-panel {
    flex: 0 0 240px;
    max-width: 50%;
    overflow: auto;
    padding: 12px;
    background: #f6f8fa;
    color: #243447;
    border-left: 1px solid #ccd4de;
    font-size: 12px;
}
.metadata-panel dt {
    font-weight: 600;
    margin-top: 10px;
}
.metadata-panel dd {
    margin: 3px 0 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
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
.widget-status {
    flex-shrink: 0;
    font-size: 11px;
    padding: 3px 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
.resize-handle {
    position: absolute;
    touch-action: none;
}
.resize-n,
.resize-s {
    height: 5px;
    left: 8px;
    right: 8px;
    cursor: ns-resize;
}
.resize-n {
    top: 0;
}
.resize-s {
    bottom: 0;
}
.resize-e,
.resize-w {
    width: 5px;
    top: 8px;
    bottom: 8px;
    cursor: ew-resize;
}
.resize-e {
    right: 0;
}
.resize-w {
    left: 0;
}
.resize-ne,
.resize-nw,
.resize-se,
.resize-sw {
    width: 9px;
    height: 9px;
}
.resize-ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
}
.resize-nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
}
.resize-se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
}
.resize-sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
}
.resize-keyboard {
    position: absolute;
    bottom: 2px;
    right: 6px;
    padding: 0;
    line-height: 12px;
    border: 0;
    background: transparent;
    color: #647891;
    cursor: nwse-resize;
}
</style>
