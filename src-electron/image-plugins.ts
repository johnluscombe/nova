import { validateCrop, type ImageCrop } from "../src/types/crop";
import { validateSiddSettings, type SiddSettings } from "../src/types/sidd";
import {
    validateFormationProducts,
    validateFormationSettings,
    type FormationSettings
} from "../src/types/formation";
import {
    validatePolygon,
    type PolygonPoint,
    type RegionStatistics
} from "../src/types/region";
import { validateImageAxes, axisCoordinate } from "../src/types/axes";
import type { PixelData } from "../src/types/pixel";
import { isScaling, type Scaling } from "../src/types/scaling";
import type { SliceData, SliceOrientation } from "../src/types/slice";
import {
    validateRibbon,
    type RibbonActionContext,
    type RibbonActionResult
} from "../src/types/ribbon.ts";
import { mkdir, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
    PluginParameters,
    ImageInfo,
    ImagePluginStatus,
    ImagePluginManifest,
    ImagePluginResult
} from "../src/types/image";

/**
 * Decoder implementation contract loaded by the main-process host. Optional
 * operations advertise source-data capabilities.
 */
export interface ImagePlugin {
    /** Encode a display raster at source resolution in the requested output format. */
    exportImage?(
        filePath: string,
        outputPath: string,
        parameters: PluginParameters,
        scaling?: Scaling
    ): Promise<void>;

    /**
     * Write a crop of original source pixels inside the assigned directory.
     *
     * @param selection - Validated source-pixel rectangle, including
     * original image dimensions.
     * @returns The generated file path directly inside directory; never
     * overwrite the source.
     */
    crop?(
        filePath: string,
        directory: string,
        selection: ImageCrop,
        parameters: PluginParameters
    ): Promise<string>;

    /**
     * Write a detected SIDD to a new output path using validated display
     * and projection settings.
     */
    createSidd?(
        filePath: string,
        outputPath: string,
        settings: SiddSettings,
        parameters: PluginParameters
    ): Promise<void>;

    /**
     * Form a SICD from supported phase history and write it to the
     * assigned new output path.
     */
    formSicd?(
        filePath: string,
        outputPath: string,
        settings: FormationSettings,
        parameters: PluginParameters
    ): Promise<void>;

    /**
     * Compute statistics inside a validated source-pixel polygon.
     *
     * @param peakPower - Sampled whole-image peak used by relative-power
     * scaling.
     * @returns Numeric percentiles, a finite sample count, and whether
     * sampling was required.
     */
    readRegion?(
        filePath: string,
        polygon: PolygonPoint[],
        parameters: PluginParameters,
        scaling?: Scaling,
        peakPower?: number
    ): RegionStatistics | Promise<RegionStatistics>;

    /**
     * Return one zero-based source pixel in the selected scaling and
     * relative-power reference.
     */
    readPixel?(
        filePath: string,
        row: number,
        column: number,
        parameters: PluginParameters,
        scaling?: Scaling,
        peakPower?: number
    ): PixelData | Promise<PixelData>;

    /**
     * Read a source row or column using manifest parameters and optional
     * scaling.
     *
     * @returns Ordered samples whose positions are zero-based source pixel
     * indices. Do not convert positions to meters here.
     */
    readSlice?(
        filePath: string,
        orientation: SliceOrientation,
        index: number,
        parameters: PluginParameters,
        scaling?: Scaling
    ): SliceData | Promise<SliceData>;

    /**
     * Optionally probe whether this decoder accepts the selected file
     * before attempting a read.
     */
    canOpen?(
        filePath: string,
        parameters: PluginParameters
    ): boolean | Promise<boolean>;

    /**
     * Return source dimensions, preview, and available scientific metadata
     * for this file and scaling.
     */
    open?(
        filePath: string,
        parameters: PluginParameters,
        scaling?: Scaling
    ): ImagePluginResult | Promise<ImagePluginResult>;

    /**
     * Execute a declared plugin action with scenario context and manifest
     * parameters.
     */
    executeRibbonAction?(
        actionId: string,
        context: RibbonActionContext,
        parameters: PluginParameters
    ): RibbonActionResult | void | Promise<RibbonActionResult | void>;
}

/** A validated manifest paired with its loaded decoder implementation. */
type LoadedPlugin = {
    manifest: ImagePluginManifest;

    implementation: ImagePlugin;
};

/**
 * Discover decoders and validate their outputs at the renderer/plugin
 * boundary.
 */
export class ImagePlugins {
    /** Export supported scientific and standard rasters through the configured Python worker. */
    async exportRaster(
        filePath: string,
        outputPath: string,
        scaling?: Scaling
    ): Promise<void> {
        const plugin = this.plugins.find(
            item => item.manifest.id === "nova.sicd"
        );

        if (!plugin?.implementation.exportImage) {
            throw new Error(
                "This export format requires the Scientific Imagery plugin and its configured Python environment."
            );
        }

        if (scaling !== undefined && !isScaling(scaling)) {
            throw new Error("Invalid export scaling.");
        }

        await plugin.implementation.exportImage(
            filePath,
            outputPath,
            plugin.manifest.parameters ?? {},
            scaling
        );
    }

    private readonly openedImages = new Map<
        string,
        {
            width: number | undefined;

            height: number | undefined;

            scalingOptions?: Scaling[];

            peakPower?: number;
        }
    >();
    private plugins: LoadedPlugin[] = [];
    private errors: string[] = [];

    private readonly directory: string;

    private readonly bundledDirectory: string | undefined;

    /**
     * Configure user and optional bundled plugin directories; discovery
     * begins with reload.
     */
    constructor(directory: string, bundledDirectory?: string) {
        this.directory = directory;
        this.bundledDirectory = bundledDirectory;
    }

    /**
     * Return installed plugin manifests together with discovery errors.
     */
    get status(): ImagePluginStatus {
        return {
            directory: this.directory,
            plugins: this.plugins.map(({ manifest }) => ({
                ...manifest,
                extensions: [...manifest.extensions]
            })),
            errors: [...this.errors]
        };
    }

    /**
     * Discover and validate plugins, allowing user installations to
     * override matching bundled identifiers.
     */
    async reload(): Promise<ImagePluginStatus> {
        await mkdir(this.directory, { recursive: true });

        const plugins: LoadedPlugin[] = [];
        const errors: string[] = [];
        const entries = (await readdir(this.directory, { withFileTypes: true }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(entry => ({
                entry,
                directory: this.directory,
                bundled: false
            }));

        if (this.bundledDirectory) {
            entries.push(
                ...(
                    await readdir(this.bundledDirectory, {
                        withFileTypes: true
                    })
                )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(entry => ({
                        entry,
                        directory: this.bundledDirectory!,
                        bundled: true
                    }))
            );
        }

        for (const { entry, directory, bundled } of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            try {
                const folder = await realpath(path.join(directory, entry.name));
                const manifest = JSON.parse(
                    await readFile(path.join(folder, "plugin.json"), "utf8")
                ) as ImagePluginManifest;

                if (
                    manifest.apiVersion !== 1 ||
                    typeof manifest.id !== "string" ||
                    !/^[a-z0-9][a-z0-9.-]*$/.test(manifest.id) ||
                    typeof manifest.name !== "string" ||
                    !manifest.name.trim() ||
                    typeof manifest.main !== "string" ||
                    !Array.isArray(manifest.extensions) ||
                    !manifest.extensions.every(
                        extension =>
                            typeof extension === "string" &&
                            /^[a-z0-9]+$/.test(extension)
                    )
                ) {
                    throw new Error(
                        "Invalid image plugin manifest or unsupported API version."
                    );
                }

                if (
                    manifest.parameters !== undefined &&
                    (!manifest.parameters ||
                        typeof manifest.parameters !== "object" ||
                        Array.isArray(manifest.parameters) ||
                        !Object.values(manifest.parameters).every(
                            value =>
                                value === null ||
                                typeof value === "string" ||
                                typeof value === "boolean" ||
                                (typeof value === "number" &&
                                    Number.isFinite(value))
                        ))
                ) {
                    throw new Error(
                        "Plugin parameters must be an object of strings, finite numbers, booleans, or null."
                    );
                }

                if (manifest.parameters !== undefined) {
                    manifest.parameters = Object.freeze({
                        ...manifest.parameters
                    });
                }

                if (manifest.ribbon !== undefined) {
                    validateRibbon(manifest.ribbon);
                }

                if (
                    !manifest.extensions.length &&
                    !manifest.ribbon?.tabs.length
                ) {
                    throw new Error(
                        "Plugin must provide image types or ribbon tabs."
                    );
                }

                if (
                    plugins.some(plugin => plugin.manifest.id === manifest.id)
                ) {
                    if (bundled) {
                        continue;
                    }

                    throw new Error("Duplicate plugin ID.");
                }

                const modulePath = await realpath(
                    path.resolve(folder, manifest.main)
                );
                const relative = path.relative(folder, modulePath);

                if (
                    relative.startsWith("..") ||
                    path.isAbsolute(relative) ||
                    ![".ts", ".mjs"].includes(path.extname(modulePath))
                ) {
                    throw new Error(
                        "Plugin main must be a .ts or .mjs file inside its folder."
                    );
                }

                // External user-installed modules must stay outside the application bundle.
                // Node caches modules; restart Nova after changing an already loaded module.
                const module = (await import(
                    /* @vite-ignore */ pathToFileURL(modulePath).href
                )) as { default?: ImagePlugin };

                if (
                    !module.default ||
                    (manifest.extensions.length > 0 &&
                        typeof module.default.open !== "function") ||
                    (manifest.ribbon?.tabs.some(tab =>
                        tab.groups.some(group => group.buttons.length > 0)
                    ) &&
                        typeof module.default.executeRibbonAction !==
                            "function") ||
                    (module.default.crop !== undefined &&
                        typeof module.default.crop !== "function") ||
                    (module.default.createSidd !== undefined &&
                        typeof module.default.createSidd !== "function") ||
                    (module.default.formSicd !== undefined &&
                        typeof module.default.formSicd !== "function") ||
                    (module.default.readRegion !== undefined &&
                        typeof module.default.readRegion !== "function") ||
                    (module.default.readPixel !== undefined &&
                        typeof module.default.readPixel !== "function") ||
                    (module.default.readSlice !== undefined &&
                        typeof module.default.readSlice !== "function") ||
                    (module.default.canOpen !== undefined &&
                        typeof module.default.canOpen !== "function")
                ) {
                    throw new Error(
                        "Plugin must export handlers for its image types and ribbon buttons."
                    );
                }

                plugins.push({ manifest, implementation: module.default });
            } catch (cause) {
                errors.push(
                    `${entry.name}: ${cause instanceof Error ? cause.message : String(cause)}`
                );
            }
        }

        this.plugins = plugins;
        this.errors = errors;

        return this.status;
    }

    /**
     * Build native file-picker filters from the extensions accepted by
     * installed decoders.
     */
    get filters(): {
        name: string;

        extensions: string[];
    }[] {
        if (!this.plugins.some(plugin => plugin.manifest.extensions.length)) {
            return [];
        }

        return [
            {
                name: "Supported images",
                extensions: [
                    ...new Set(
                        this.plugins.flatMap(
                            plugin => plugin.manifest.extensions
                        )
                    )
                ]
            },
            ...this.plugins
                .filter(plugin => plugin.manifest.extensions.length)
                .map(({ manifest }) => ({
                    name: manifest.name,
                    extensions: manifest.extensions
                }))
        ];
    }

    /**
     * Validate a declared action and its scenario requirement before
     * invoking the owning plugin.
     */
    async executeRibbonAction(
        pluginId: string,
        actionId: string,
        context: RibbonActionContext
    ): Promise<RibbonActionResult> {
        const plugin = this.plugins.find(
            plugin => plugin.manifest.id === pluginId
        );
        const button = plugin?.manifest.ribbon?.tabs
            .flatMap(tab => tab.groups.flatMap(group => group.buttons))
            .find(button => button.id === actionId);

        if (!plugin || !button || !plugin.implementation.executeRibbonAction) {
            throw new Error("Unknown plugin ribbon action.");
        }

        if (button.requiresScenario && !context.scenarioPath) {
            throw new Error("Open a scenario before using this action.");
        }

        const result = await plugin.implementation.executeRibbonAction(
            actionId,
            { scenarioPath: context.scenarioPath },
            plugin.manifest.parameters ?? Object.freeze({})
        );

        if (result === undefined) {
            return {};
        }

        if (
            !result ||
            typeof result !== "object" ||
            (result.message !== undefined && typeof result.message !== "string")
        ) {
            throw new Error("Invalid plugin action result.");
        }

        return result.message === undefined ? {} : { message: result.message };
    }

    /**
     * Validate an opened image and polygon, then validate finite source
     * statistics returned by its plugin.
     */
    async readRegion(
        filePath: string,
        pluginId: string,
        polygon: PolygonPoint[],
        scaling?: Scaling
    ): Promise<RegionStatistics> {
        const image = this.openedImages.get(
            JSON.stringify([filePath, pluginId])
        );
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (
            !image?.width ||
            !image.height ||
            !plugin?.implementation.readRegion
        ) {
            throw new Error("Open an image with source region support first.");
        }

        const points = validatePolygon(polygon, image.width, image.height);

        if (
            scaling !== undefined &&
            (!isScaling(scaling) || !image.scalingOptions?.includes(scaling))
        ) {
            throw new Error("Scaling is unavailable for this image.");
        }

        const result = await plugin.implementation.readRegion(
            filePath,
            points,
            plugin.manifest.parameters ?? {},
            scaling,
            image.peakPower
        );

        /**
         * Require a bounded, nonempty collection of finite or null numeric
         * statistics.
         */
        const validStatistics = (statistics: unknown) =>
            statistics &&
            typeof statistics === "object" &&
            !Array.isArray(statistics) &&
            Object.keys(statistics).length > 0 &&
            Object.keys(statistics).length <= 200 &&
            Object.entries(statistics).every(
                ([key, value]) =>
                    key.length <= 100 &&
                    (value === null ||
                        (typeof value === "number" && Number.isFinite(value)))
            );

        if (
            !result ||
            !validStatistics(result.statistics) ||
            typeof result.valueLabel !== "string" ||
            !result.valueLabel.length ||
            result.valueLabel.length > 100 ||
            !Number.isSafeInteger(result.sampleCount) ||
            result.sampleCount < 0 ||
            result.sampleCount > 2560000 ||
            typeof result.sampled !== "boolean" ||
            (result.wholeImageStatistics !== undefined &&
                !validStatistics(result.wholeImageStatistics))
        ) {
            throw new Error("Plugin returned invalid region statistics.");
        }

        return result;
    }

    /**
     * Validate source pixel bounds and scaling before reading a value from
     * the owning plugin.
     */
    async readPixel(
        filePath: string,
        pluginId: string,
        row: number,
        column: number,
        scaling?: Scaling
    ): Promise<PixelData> {
        const image = this.openedImages.get(
            JSON.stringify([filePath, pluginId])
        );
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (!image || !plugin?.implementation.readPixel) {
            throw new Error("Open an image with source pixel support first.");
        }

        if (
            !Number.isSafeInteger(row) ||
            !Number.isSafeInteger(column) ||
            row < 0 ||
            column < 0 ||
            row >= (image.height ?? 0) ||
            column >= (image.width ?? 0)
        ) {
            throw new Error("Pixel is outside the image.");
        }

        if (
            scaling !== undefined &&
            (!isScaling(scaling) || !image.scalingOptions?.includes(scaling))
        ) {
            throw new Error("Scaling is unavailable for this image.");
        }

        const result = await plugin.implementation.readPixel(
            filePath,
            row,
            column,
            plugin.manifest.parameters ?? {},
            scaling,
            image.peakPower
        );

        if (
            !result ||
            typeof result.valueLabel !== "string" ||
            !result.valueLabel.length ||
            result.valueLabel.length > 100 ||
            !(
                result.value === null ||
                (typeof result.value === "number" &&
                    Number.isFinite(result.value))
            )
        ) {
            throw new Error("Plugin returned invalid pixel data.");
        }

        return { value: result.value, valueLabel: result.valueLabel };
    }

    /**
     * Validate a source slice request and the ordered sample positions
     * returned by the plugin.
     */
    async readSlice(
        filePath: string,
        pluginId: string,
        orientation: SliceOrientation,
        index: number,
        scaling?: Scaling
    ): Promise<SliceData> {
        const image = this.openedImages.get(
            JSON.stringify([filePath, pluginId])
        );
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (!image || !plugin?.implementation.readSlice) {
            throw new Error("Open an image with source slice support first.");
        }

        const limit = orientation === "horizontal" ? image.height : image.width;

        if (
            !["horizontal", "vertical"].includes(orientation) ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            limit === undefined ||
            index >= limit
        ) {
            throw new Error("Slice index is outside the image.");
        }

        if (
            scaling !== undefined &&
            (!isScaling(scaling) || !image.scalingOptions?.includes(scaling))
        ) {
            throw new Error("Scaling is unavailable for this image.");
        }

        const result = await plugin.implementation.readSlice(
            filePath,
            orientation,
            index,
            plugin.manifest.parameters ?? {},
            scaling
        );
        const length =
            orientation === "horizontal" ? image.width : image.height;

        if (
            !result ||
            !Array.isArray(result.points) ||
            !result.points.length ||
            result.points.length > 4096 ||
            typeof result.positionLabel !== "string" ||
            result.positionLabel.length > 100 ||
            typeof result.valueLabel !== "string" ||
            result.valueLabel.length > 100 ||
            !result.points.every(
                (point, i) =>
                    point &&
                    Number.isSafeInteger(point.position) &&
                    point.position >= 0 &&
                    point.position < (length ?? 0) &&
                    (i === 0 ||
                        point.position > result.points[i - 1]!.position) &&
                    (point.value === null ||
                        (typeof point.value === "number" &&
                            Number.isFinite(point.value)))
            )
        ) {
            throw new Error("Plugin returned invalid slice data.");
        }

        return result;
    }

    /**
     * Require an opened phase-history source, validate formation settings,
     * and open the generated SICD.
     */
    async formSicd(
        filePath: string,
        pluginId: string,
        outputPath: string,
        settings: FormationSettings
    ): Promise<ImageInfo> {
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (
            !this.openedImages.has(JSON.stringify([filePath, pluginId])) ||
            !plugin?.implementation.formSicd
        ) {
            throw new Error(
                "Open a CPHD image with image formation support first."
            );
        }

        const options = validateFormationSettings(settings);

        await plugin.implementation.formSicd(
            filePath,
            outputPath,
            options,
            plugin.manifest.parameters ?? {}
        );

        return this.open(outputPath, pluginId);
    }

    /**
     * Validate source bounds and output location before opening a crop
     * produced by the owning plugin.
     */
    async crop(
        filePath: string,
        pluginId: string,
        directory: string,
        selection: ImageCrop
    ): Promise<ImageInfo> {
        const image = this.openedImages.get(
            JSON.stringify([filePath, pluginId])
        );
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (!image || !plugin?.implementation.crop) {
            throw new Error("Open an image with crop support first.");
        }

        const crop = validateCrop(selection, image.width, image.height);
        const output = await plugin.implementation.crop(
            filePath,
            directory,
            crop,
            plugin.manifest.parameters ?? {}
        );

        if (
            typeof output !== "string" ||
            path.dirname(path.resolve(output)) !== path.resolve(directory) ||
            output === filePath
        ) {
            throw new Error("Plugin returned an invalid cropped image path.");
        }

        return this.open(output, pluginId);
    }

    /**
     * Require an opened source, validate SIDD preferences, and open the
     * completed detected product.
     */
    async createSidd(
        filePath: string,
        pluginId: string,
        outputPath: string,
        settings: SiddSettings
    ): Promise<ImageInfo> {
        const plugin = this.plugins.find(item => item.manifest.id === pluginId);

        if (
            !this.openedImages.has(JSON.stringify([filePath, pluginId])) ||
            !plugin?.implementation.createSidd
        ) {
            throw new Error(
                "Open a SICD image with SIDD creation support first."
            );
        }

        const options = validateSiddSettings(settings);

        await plugin.implementation.createSidd(
            filePath,
            outputPath,
            options,
            plugin.manifest.parameters ?? {}
        );

        return this.open(outputPath, pluginId);
    }

    /**
     * Require a supported scaling mode before reopening the image through
     * its original decoder.
     */
    async rescale(
        filePath: string,
        pluginId: string,
        scaling: Scaling
    ): Promise<ImageInfo> {
        const image = this.openedImages.get(
            JSON.stringify([filePath, pluginId])
        );

        if (!isScaling(scaling) || !image?.scalingOptions?.includes(scaling)) {
            throw new Error("Scaling is unavailable for this image.");
        }

        return this.open(filePath, pluginId, scaling);
    }

    /**
     * Try matching decoders, validate their output, and register source
     * dimensions for later analysis reads.
     */
    async open(
        filePath: string,
        pluginId?: string,
        scaling?: Scaling
    ): Promise<ImageInfo> {
        if (!this.plugins.length) {
            throw new Error("Install an image plugin before opening images.");
        }

        const extension = path.extname(filePath).slice(1).toLowerCase();
        const candidates = this.plugins.filter(
            plugin =>
                plugin.manifest.extensions.includes(extension) &&
                (!pluginId || plugin.manifest.id === pluginId)
        );
        const failures: string[] = [];

        for (const { manifest, implementation } of candidates) {
            try {
                if (
                    implementation.canOpen &&
                    !(await implementation.canOpen(
                        filePath,
                        manifest.parameters ?? Object.freeze({})
                    ))
                ) {
                    continue;
                }

                const result = await implementation.open!(
                    filePath,
                    manifest.parameters ?? Object.freeze({}),
                    scaling
                );

                if (!result || typeof result !== "object") {
                    throw new Error("Invalid image result.");
                }

                for (const field of ["metadata", "statistics"] as const) {
                    if (
                        result[field] !== undefined &&
                        (!result[field] ||
                            typeof result[field] !== "object" ||
                            Array.isArray(result[field]) ||
                            Object.keys(result[field]).length > 200 ||
                            !Object.entries(result[field]).every(
                                ([key, value]) =>
                                    key.length <= 200 &&
                                    (value === null ||
                                        typeof value === "boolean" ||
                                        (typeof value === "number" &&
                                            Number.isFinite(value)) ||
                                        (typeof value === "string" &&
                                            value.length <= 10000))
                            ))
                    ) {
                        throw new Error(`Invalid image ${field}.`);
                    }
                }

                for (const dimension of [result.width, result.height]) {
                    if (
                        dimension !== undefined &&
                        (!Number.isSafeInteger(dimension) || dimension <= 0)
                    ) {
                        throw new Error("Invalid image dimensions.");
                    }
                }

                if (
                    result.previewDataUrl !== undefined &&
                    (typeof result.previewDataUrl !== "string" ||
                        result.previewDataUrl.length > 32 * 1024 * 1024 ||
                        !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(
                            result.previewDataUrl
                        ))
                ) {
                    throw new Error(
                        "Preview must be a PNG, JPEG, WebP, or SVG data URL under 32 MB."
                    );
                }

                if (scaling !== undefined && result.scaling !== scaling) {
                    throw new Error(
                        "Plugin did not return the requested scaling."
                    );
                }

                if (
                    result.scalingOptions !== undefined &&
                    (!Array.isArray(result.scalingOptions) ||
                        !result.scalingOptions.length ||
                        result.scalingOptions.length > 15 ||
                        !result.scalingOptions.every(isScaling) ||
                        !isScaling(result.scaling) ||
                        !result.scalingOptions.includes(result.scaling))
                ) {
                    throw new Error("Invalid image scaling options.");
                }

                if (
                    result.peakPower !== undefined &&
                    (typeof result.peakPower !== "number" ||
                        !Number.isFinite(result.peakPower) ||
                        result.peakPower < 0)
                ) {
                    throw new Error("Invalid image peak power.");
                }

                if (result.axes !== undefined) {
                    validateImageAxes(result.axes);

                    if (
                        !result.width ||
                        !result.height ||
                        !Number.isFinite(
                            axisCoordinate(result.axes.row, result.height - 1)
                        ) ||
                        !Number.isFinite(
                            axisCoordinate(result.axes.column, result.width - 1)
                        )
                    ) {
                        throw new Error("Invalid image axis dimensions.");
                    }
                }

                let formationProducts;

                if (result.formationProducts !== undefined) {
                    try {
                        formationProducts = validateFormationProducts(
                            result.formationProducts
                        );
                    } catch {
                        result.metadata = {
                            ...result.metadata,
                            "Formation previews":
                                "Unavailable: invalid diagnostic preview data."
                        };
                    }
                }

                const info: ImageInfo = {
                    ...(implementation.crop &&
                    result.metadata?.Format !== "CPHD"
                        ? { supportsCrop: true }
                        : {}),
                    ...(formationProducts ? { formationProducts } : {}),
                    ...(implementation.readRegion
                        ? { supportsSourceRegions: true }
                        : {}),
                    ...(result.axes ? { axes: result.axes } : {}),
                    ...(implementation.readPixel
                        ? { supportsSourcePixels: true }
                        : {}),
                    ...(result.scalingOptions
                        ? {
                              scalingOptions: result.scalingOptions,
                              scaling: result.scaling
                          }
                        : {}),
                    ...(implementation.readSlice
                        ? { supportsSourceSlices: true }
                        : {}),
                    ...(result.statistics !== undefined
                        ? { statistics: result.statistics }
                        : {}),
                    ...(result.metadata !== undefined
                        ? { metadata: result.metadata }
                        : {}),
                    name: path.basename(filePath),
                    path: filePath,
                    pluginId: manifest.id,
                    pluginName: manifest.name,
                    ...(result.width !== undefined
                        ? { width: result.width }
                        : {}),
                    ...(result.height !== undefined
                        ? { height: result.height }
                        : {}),
                    ...(result.previewDataUrl !== undefined
                        ? { previewDataUrl: result.previewDataUrl }
                        : {})
                };

                this.openedImages.set(JSON.stringify([filePath, manifest.id]), {
                    ...(result.peakPower !== undefined
                        ? { peakPower: result.peakPower }
                        : {}),
                    width: info.width,
                    height: info.height,
                    ...(info.scalingOptions
                        ? { scalingOptions: info.scalingOptions }
                        : {})
                });

                return info;
            } catch (cause) {
                failures.push(
                    `${manifest.name}: ${cause instanceof Error ? cause.message : String(cause)}`
                );
            }
        }

        throw new Error(
            failures.length
                ? failures.join("\n")
                : "No installed image plugin can open this file."
        );
    }
}
