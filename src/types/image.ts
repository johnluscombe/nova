import type { ImageCrop } from "./crop";
import type { SiddSettings } from "./sidd";
import type { FormationProduct, FormationSettings } from "./formation";
import type { PolygonPoint, RegionStatistics } from "./region";
import type { ImageImportUpdate, ImageImportResult } from "./image-import";
import type { MetadataAttachment } from "./metadata";
import type { ImageAxes } from "./axes";
import type { PixelData } from "./pixel";
import type { Scaling } from "./scaling";
import type { SliceData, SliceOrientation } from "./slice";
import type { PluginRibbon, RibbonActionResult } from "./ribbon";
export type PluginParameters = Readonly<
    Record<string, string | number | boolean | null>
>;

export interface ImagePluginManifest {
    apiVersion: 1;
    id: string;
    name: string;
    main: string;
    extensions: string[];
    ribbon?: PluginRibbon;
    parameters?: PluginParameters;
}

export interface ImagePluginResult {
    formationProducts?: FormationProduct[];
    axes?: ImageAxes;
    peakPower?: number;
    scalingOptions?: Scaling[];
    scaling?: Scaling;
    statistics?: Record<string, string | number | boolean | null>;
    metadata?: Record<string, string | number | boolean | null>;
    width?: number;
    height?: number;
    previewDataUrl?: string;
}

export interface ImageInfo extends ImagePluginResult {
    embeddedAxes?: ImageAxes;
    axesSource?: string;
    axesNotice?: string;
    attachedMetadata?: MetadataAttachment[];
    name: string;
    path: string;
    pluginId: string;
    pluginName: string;
    supportsCrop?: boolean;
    supportsSourceSlices?: boolean;
    supportsSourcePixels?: boolean;
    supportsSourceRegions?: boolean;
}

export interface ImagePluginStatus {
    directory: string;
    plugins: ImagePluginManifest[];
    errors: string[];
}

export interface ImageAPI {
    crop(
        filePath: string,
        pluginId: string,
        selection: ImageCrop
    ): Promise<ImageInfo>;
    createSidd(
        filePath: string,
        pluginId: string,
        settings: SiddSettings
    ): Promise<ImageInfo>;
    formSicd(
        filePath: string,
        pluginId: string,
        settings: FormationSettings
    ): Promise<ImageInfo>;
    region(
        filePath: string,
        pluginId: string,
        polygon: PolygonPoint[],
        scaling?: Scaling
    ): Promise<RegionStatistics>;
    importFiles(
        onUpdate: (update: ImageImportUpdate) => void,
        paths?: string | string[]
    ): Promise<ImageImportResult>;
    attachMetadata(imagePath: string): Promise<MetadataAttachment[] | null>;
    pixel(
        filePath: string,
        pluginId: string,
        row: number,
        column: number,
        scaling?: Scaling
    ): Promise<PixelData>;
    rescale(
        filePath: string,
        pluginId: string,
        scaling: Scaling
    ): Promise<ImageInfo>;
    pathForFile(file: File): string;
    slice(
        filePath: string,
        pluginId: string,
        orientation: SliceOrientation,
        index: number,
        scaling?: Scaling
    ): Promise<SliceData>;
    open(
        onLoading?: (image: ImageInfo) => void,
        filePath?: string
    ): Promise<ImageInfo | null>;
    plugins(): Promise<ImagePluginStatus>;
    executeRibbonAction(
        pluginId: string,
        actionId: string
    ): Promise<RibbonActionResult>;
}

declare global {
    interface Window {
        images?: ImageAPI;
    }
}
