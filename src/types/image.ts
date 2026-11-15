import type { ColorScale } from "./color-scale";
import type { ImageSaveOptions } from "./image-export";
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

/**
 * Read-only manifest configuration passed to plugin operations; values must be
 * JSON scalars.
 */
export type PluginParameters = Readonly<
    Record<string, string | number | boolean | null>
>;

/**
 * Plugin discovery contract loaded from plugin.json. Paths and extensions
 * identify the decoder entry point and supported files.
 */
export interface ImagePluginManifest {
    /** Manifest protocol version supported by the host. */
    apiVersion: 1;

    /** Stable plugin identifier used in saved scenarios. */
    id: string;

    name: string;

    /** Module entry point relative to the plugin directory. */
    main: string;

    /** Supported lowercase filename suffixes without a leading dot. */
    extensions: string[];

    ribbon?: PluginRibbon;

    /** Plugin-specific settings, such as the Python interpreter path. */
    parameters?: PluginParameters;
}

/**
 * Decoder output shared across the plugin boundary. Optional fields describe
 * capabilities and data available for this particular image.
 */
export interface ImagePluginResult {
    formationProducts?: FormationProduct[];

    /** Physical or pixel coordinate mappings for the source grid. */
    axes?: ImageAxes;

    /**
     * Sampled whole-image power reference used to keep relative-power reads
     * consistent.
     */
    peakPower?: number;

    /** Representations this image can actually supply. */
    scalingOptions?: Scaling[];

    /** Representation used for the current preview and statistics. */
    scaling?: Scaling;

    /**
     * Decoder-provided statistics; percentile entries are selected for display
     * by user settings.
     */
    statistics?: Record<string, string | number | boolean | null>;

    metadata?: Record<string, string | number | boolean | null>;

    /** Original source width in pixels, rather than preview width. */
    width?: number;

    /** Original source height in pixels, rather than preview height. */
    height?: number;

    /**
     * Encoded display preview; its dimensions may be smaller than the source
     * grid.
     */
    previewDataUrl?: string;
}

/**
 * Opened image identity and decoder output, enriched by the host with metadata
 * attachments, axis selection, and source-operation capabilities.
 */
export interface ImageInfo extends ImagePluginResult {
    /**
     * Original decoder axes retained when a sidecar overrides the displayed
     * axes.
     */
    embeddedAxes?: ImageAxes;

    /**
     * Resolved coordinate source: "embedded", "pixel", or an attached metadata
     * path.
     */
    axesSource?: string;

    /** Explanation shown when resolving attached coordinate metadata. */
    axesNotice?: string;

    attachedMetadata?: MetadataAttachment[];

    name: string;

    /** Native source path used for subsequent reader operations. */
    path: string;

    pluginId: string;

    pluginName: string;

    /** Whether the decoder can persist a crop of source data. */
    supportsCrop?: boolean;

    /**
     * Whether line graphs can use original samples rather than preview pixels.
     */
    supportsSourceSlices?: boolean;

    /** Whether inspection can read exact original samples. */
    supportsSourcePixels?: boolean;

    /** Whether polygon statistics can be computed from original samples. */
    supportsSourceRegions?: boolean;
}

/**
 * Result of plugin discovery, including usable manifests and errors
 * encountered while loading plugins.
 */
export interface ImagePluginStatus {
    directory: string;

    plugins: ImagePluginManifest[];

    errors: string[];
}

/**
 * Renderer-facing image operations exposed by the Electron preload bridge.
 * Source reads and file writes run through the main process.
 */
export interface ImageAPI {
    /** Render a scientific preview using source-unit clipping limits and an RGB palette. */
    colorScale(
        filePath: string,
        pluginId: string,
        scale: ColorScale | undefined,
        scaling?: Scaling
    ): Promise<ImageInfo>;

    /**
     * Save native bytes or convert to the destination raster encoding using the
     * selected display scaling. Return the destination or null on cancellation.
     * Always request a destination.
     */
    save(filePath: string, options?: ImageSaveOptions): Promise<string | null>;

    /**
     * Create a persistent source-pixel crop and return its decoded image
     * information.
     *
     * @param selection - Integer pixel edges and dimensions in the original
     * source grid.
     * @returns The new image; the caller controls widget creation and
     * loading state.
     */
    crop(
        filePath: string,
        pluginId: string,
        selection: ImageCrop
    ): Promise<ImageInfo>;

    /**
     * Create a detected SIDD from an already opened SICD and return the new
     * product.
     *
     * @param settings - Ground spacing, interpolation, bit depth, and
     * display remap preferences.
     * @returns Decoded image information for the persistent SIDD file.
     */
    createSidd(
        filePath: string,
        pluginId: string,
        settings: SiddSettings
    ): Promise<ImageInfo>;

    /**
     * Form a persistent SICD from an already opened CPHD and return its
     * image information.
     *
     * @param settings - Backprojection aperture, output grid, and windowing
     * preferences.
     */
    formSicd(
        filePath: string,
        pluginId: string,
        settings: FormationSettings
    ): Promise<ImageInfo>;

    /**
     * Compute bounded source-polygon statistics for an opened image.
     *
     * @param polygon - Vertices in source-pixel edge coordinates,
     * independent of display size.
     * @param scaling - A source-supported numerical quantity; preview
     * luminance is a renderer fallback.
     */
    region(
        filePath: string,
        pluginId: string,
        polygon: PolygonPoint[],
        scaling?: Scaling
    ): Promise<RegionStatistics>;

    /**
     * Import selected paths or show a native picker.
     *
     * @param onUpdate - Receives loading placeholders followed by final
     * image or error states.
     * @param paths - Native image, ZIP, or metadata paths; omit to open the
     * file picker.
     * @returns Collected import failures after final progress states have
     * been reconciled.
     */
    importFiles(
        onUpdate: (update: ImageImportUpdate) => void,
        paths?: string | string[]
    ): Promise<ImageImportResult>;

    /**
     * Choose JSON sidecars for an image; return null when the native
     * picker is canceled.
     */
    attachMetadata(imagePath: string): Promise<MetadataAttachment[] | null>;

    /**
     * Read an exact source pixel in a supported numerical scaling.
     *
     * @param row - Zero-based source row index.
     * @param column - Zero-based source column index.
     * @returns A finite value or null when the selected quantity is
     * undefined.
     */
    pixel(
        filePath: string,
        pluginId: string,
        row: number,
        column: number,
        scaling?: Scaling
    ): Promise<PixelData>;

    /**
     * Reopen an image preview and statistics using a supported numerical
     * scaling mode.
     */
    rescale(
        filePath: string,
        pluginId: string,
        scaling: Scaling,
        colorScale?: ColorScale
    ): Promise<ImageInfo>;

    /**
     * Resolve a desktop File object to its native path for drag-and-drop
     * imports.
     */
    pathForFile(file: File): string;

    /**
     * Read source samples along a row or column for an independent line
     * graph.
     *
     * @param index - Zero-based row for horizontal slices, or column for
     * vertical slices.
     * @returns Ordered source pixel positions; physical-axis conversion
     * happens in the renderer.
     */
    slice(
        filePath: string,
        pluginId: string,
        orientation: SliceOrientation,
        index: number,
        scaling?: Scaling
    ): Promise<SliceData>;

    /**
     * Open one image, optionally delivering a loading placeholder before
     * its reader finishes.
     */
    open(
        onLoading?: (image: ImageInfo) => void,
        filePath?: string
    ): Promise<ImageInfo | null>;

    /**
     * Return the installed image plugin manifests and any discovery
     * errors.
     */
    plugins(): Promise<ImagePluginStatus>;

    /**
     * Invoke a declared plugin ribbon action through the main-process
     * host.
     */
    executeRibbonAction(
        pluginId: string,
        actionId: string
    ): Promise<RibbonActionResult>;
}

declare global {
    /** Electron preload additions to the renderer browser window. */
    interface Window {
        images?: ImageAPI;
    }
}
