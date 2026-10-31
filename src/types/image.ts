import type { PluginRibbon, RibbonActionResult } from "./ribbon";
export interface ImagePluginManifest {
    apiVersion: 1;
    id: string;
    name: string;
    main: string;
    extensions: string[];
    ribbon?: PluginRibbon;
}

export interface ImagePluginResult {
    width?: number;
    height?: number;
    previewDataUrl?: string;
}

export interface ImageInfo extends ImagePluginResult {
    name: string;
    path: string;
    pluginId: string;
    pluginName: string;
}

export interface ImagePluginStatus {
    directory: string;
    plugins: ImagePluginManifest[];
    errors: string[];
}

export interface ImageAPI {
    open(): Promise<ImageInfo | null>;
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
