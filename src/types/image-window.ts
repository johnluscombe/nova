import type { ImageInfo } from "./image";
import type { PolygonPoint, RegionStatistics } from "./region";
import type { SliceData, SliceSelection } from "./slice";
import type { WindowRect } from "@/utils/window-geometry";

/**
 * Runtime widget state; persistence is deliberately limited by
 * SavedImageWindow.
 */
export interface ImageWindow {
    /** Session-local widget identifier used for asynchronous updates. */
    id: number;

    image: ImageInfo;

    /** Current window geometry in workspace CSS pixels. */
    rect: WindowRect;

    minimized: boolean;

    maximized: boolean;

    /** Stacking order within the workspace. */
    z: number;

    error?: string;

    loading?: boolean;

    metadataOpen?: boolean;

    statisticsOpen?: boolean;

    sliceEnabled?: boolean;

    pixelValuesEnabled?: boolean;

    axesEnabled?: boolean;

    polygonDrawing?: boolean;

    cropping?: boolean;

    /** Selected polygon in source pixel-edge coordinates. */
    region?: PolygonPoint[];

    regionResult?: RegionStatistics;

    regionBusy?: boolean;

    regionError?: string;

    /** Monotonic request token used to discard stale region responses. */
    regionVersion?: number;

    /**
     * Whole-image percentiles computed from the display preview as a fallback.
     */
    previewWholeStatistics?: Record<string, number | null>;

    previewWholeSampled?: boolean;

    wholeStatisticsBusy?: boolean;

    previewStatisticsError?: string;

    /**
     * Diagnostic slide identifier when this window shows a formation product.
     */
    formationProductId?: string;

    /** Selected embedded or attached axis source. */
    metadataAxesSource?: string;

    /**
     * Present for line-graph widgets; retains source identity and unconverted
     * samples.
     */
    graph?: {
        data?: SliceData;

        rawData?: SliceData;

        source: ImageInfo;

        sourceId?: number | undefined;

        selection: SliceSelection;
    };
}
