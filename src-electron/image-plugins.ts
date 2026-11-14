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

export interface ImagePlugin {
    canOpen?(
        filePath: string,
        parameters: PluginParameters
    ): boolean | Promise<boolean>;
    open?(
        filePath: string,
        parameters: PluginParameters
    ): ImagePluginResult | Promise<ImagePluginResult>;
    executeRibbonAction?(
        actionId: string,
        context: RibbonActionContext,
        parameters: PluginParameters
    ): RibbonActionResult | void | Promise<RibbonActionResult | void>;
}

type LoadedPlugin = {
    manifest: ImagePluginManifest;
    implementation: ImagePlugin;
};

export class ImagePlugins {
    private plugins: LoadedPlugin[] = [];
    private errors: string[] = [];

    private readonly directory: string;

    private readonly bundledDirectory: string | undefined;

    constructor(directory: string, bundledDirectory?: string) {
        this.directory = directory;
        this.bundledDirectory = bundledDirectory;
    }

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

    get filters(): { name: string; extensions: string[] }[] {
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

    async open(filePath: string, pluginId?: string): Promise<ImageInfo> {
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
                    manifest.parameters ?? Object.freeze({})
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
                return {
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
