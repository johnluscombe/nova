import type { Ref } from "vue";
import type { ImageWindow } from "@/types/image-window";
import { previewRegionStatistics } from "@/utils/region-statistics";

/**
 * Manage bounded whole-image and region statistics for live workspace windows.
 */
export function useImageStatistics(windows: Ref<ImageWindow[]>) {
    /**
     * Describe the numerical quantity and sampling used by the visible
     * whole-image statistics.
     */
    function statisticsLabel(widget: ImageWindow) {
        return (
            widget.image.metadata?.Scaling ??
            widget.image.metadata?.["Statistics quantity"] ??
            (widget.previewWholeStatistics
                ? `Preview luminance (0–255)${widget.previewWholeSampled ? " (sampled)" : ""}`
                : undefined)
        );
    }

    /**
     * Choose raw region or whole-image statistics for the panel.
     */
    function displayStatistics(
        widget: ImageWindow
    ): Record<string, string | number | boolean | null> {
        return (
            (widget.region
                ? widget.regionResult?.statistics
                : (widget.image.statistics ?? widget.previewWholeStatistics)) ??
            {}
        );
    }

    /**
     * Cache bounded luminance statistics for raster and SVG previews without
     * source statistics.
     *
     * Results are applied only while the widget still exists and its preview URL
     * is unchanged. A selected polygon continues to take precedence over
     * whole-image results.
     */
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

    /**
     * Recompute polygon percentiles, discarding results superseded by a newer
     * selection or closed window.
     */
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

    return {
        statisticsLabel,
        displayStatistics,
        initializePreviewStatistics,
        refreshRegion
    };
}
