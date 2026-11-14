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
    statistics?: Record<string, string | number | boolean | null>;
    metadata?: Record<string, string | number | boolean | null>;
    width?: number;
    height?: number;
    previewDataUrl?: string;
}

export interface ImageInfo extends ImagePluginResult {
    name: string;
    path: string;
    pluginId: string;
    pluginName: string;
    supportsSourceSlices?: boolean;
}

export interface ImagePluginStatus {
    directory: string;
    plugins: ImagePluginManifest[];
    errors: string[];
}

export interface ImageAPI {
    pathForFile(file: File): string;
    slice(
        filePath: string,
        pluginId: string,
        orientation: SliceOrientation,
        index: number
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
