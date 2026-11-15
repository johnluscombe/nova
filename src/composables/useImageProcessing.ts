import { validateColorScale } from "@/types/color-scale";
import type { Ref, ComputedRef } from "vue";
import type { ImageInfo } from "@/types/image";
import type { ImageWindow } from "@/types/image-window";
import type { FormationProduct } from "@/types/formation";
import type { ImageCrop } from "@/types/crop";
import type { SliceSelection } from "@/types/slice";
import type { Scaling } from "@/types/scaling";
import { formationSettings, siddSettings } from "@/composables/useSettings";
import { sliceAxes, slicePosition } from "@/utils/slice-axes";
import { previewSlice } from "@/utils/image-slice";

/**
 * Workspace state and lifecycle callbacks required to create derived products
 * and update analysis windows.
 */
interface ProcessingContext {
    windows: Ref<ImageWindow[]>;

    activeWidget: ComputedRef<ImageWindow | undefined>;

    add: (image: ImageInfo, loading?: boolean) => number;

    complete: (id: number, image: ImageInfo) => void;

    fail: (id: number, message: string) => void;

    refreshMetadataAxes: (widget: ImageWindow) => void;

    refreshRegion: (widget: ImageWindow) => Promise<void>;

    diagnosticProduct: (widget: ImageWindow) => FormationProduct | undefined;

    onError: (message: string) => void;
}

/**
 * Coordinate asynchronous image products and graphs through the workspace's
 * window lifecycle.
 */
export function useImageProcessing(context: ProcessingContext) {
    const {
        windows,
        activeWidget,
        add,
        complete,
        fail,
        refreshMetadataAxes,
        refreshRegion,
        diagnosticProduct,
        onError
    } = context;

    /**
     * Create a source-pixel crop in a loading widget while retaining the
     * original image window.
     */
    async function cropImage(widget: ImageWindow, selection: ImageCrop) {
        widget.cropping = false;

        const source = widget.image;
        const id = add(
            {
                name: `${source.name} — cropping`,
                path: "",
                pluginId: "",
                pluginName: source.pluginName
            },
            true
        );

        try {
            complete(
                id,
                await window.images!.crop(source.path, source.pluginId, {
                    ...selection
                })
            );
        } catch (cause) {
            const message =
                cause instanceof Error ? cause.message : String(cause);

            fail(id, message);
            onError(message);
        }
    }

    /**
     * Open an independent line graph and populate it from source samples or
     * preview luminance.
     */
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

    /**
     * Open a loading widget and form a persistent SICD from the active CPHD
     * using saved settings.
     */
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
            const message =
                cause instanceof Error ? cause.message : String(cause);

            fail(id, message);
            onError(message);
        }
    }

    /**
     * Open a loading widget and derive a persistent SIDD from the active
     * source SICD.
     */
    async function createSidd() {
        const widget = activeWidget.value;

        if (
            !widget ||
            widget.loading ||
            widget.graph ||
            diagnosticProduct(widget) ||
            widget.image.metadata?.Format !== "SICD / NITF"
        ) {
            return;
        }

        const source = widget.image;
        const id = add(
            {
                name: `${source.name} — creating SIDD`,
                path: "",
                pluginId: "",
                pluginName: "Scientific Imagery"
            },
            true
        );

        try {
            const result = await window.images!.createSidd(
                source.path,
                source.pluginId,
                { ...siddSettings.value }
            );

            complete(id, result);
        } catch (cause) {
            const message =
                cause instanceof Error ? cause.message : String(cause);

            fail(id, message);
            onError(message);
        }
    }

    /**
     * Refresh the active image or graph for a supported scaling mode,
     * preserving failures for display.
     */
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
                    scaling,
                    ...(widget.colorScale
                        ? [validateColorScale(widget.colorScale)]
                        : [])
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
            onError(
                cause instanceof Error
                    ? cause.message
                    : "Unable to change scaling."
            );
        } finally {
            widget.loading = false;
        }
    }

    return { cropImage, createSliceGraph, formSicd, createSidd, setScaling };
}
