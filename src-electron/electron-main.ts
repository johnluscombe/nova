import type { ImageSaveOptions } from "../src/types/image-export";
import { ImageSaver, rasterExportExtensions } from "./image-save";
import type { ImageCrop } from "../src/types/crop";
import type { SiddSettings } from "../src/types/sidd";
import type { FormationSettings } from "../src/types/formation";
import { randomUUID } from "node:crypto";
import type { PolygonPoint } from "../src/types/region";
import { prepareImport, readMetadata } from "./image-import";
import type { ImageImportUpdate } from "../src/types/image-import";
import type { ImageInfo } from "../src/types/image";
import type { Scaling } from "../src/types/scaling";
import type { SliceOrientation } from "../src/types/slice";
import { BrowserWindow, app, dialog, nativeImage } from "electron";
import { ImagePlugins } from "./image-plugins";
import { ScenarioDatabase } from "./scenario-database";
import path from "node:path";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import type { ScenarioInfo, RestoredImageUpdate } from "../src/types/scenario";
import os from "node:os";
import {
    registerQuasarRuntime,
    resolveElectronAssetsPath
} from "#q-app/electron/main";

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();
let quitRequested = false;

app.on("before-quit", () => {
    quitRequested = true;
});

/**
 * Create the desktop window, initialize document services, and register
 * renderer IPC handlers.
 */
async function createWindow() {
    /**
     * Initial window options
     */
    const mainWindow = new BrowserWindow({
        icon: resolveElectronAssetsPath("icons/nova.png"), // Windows and Linux
        width: 1000,
        height: 600,
        frame: platform === "darwin",
        ...(platform === "darwin"
            ? {
                  titleBarStyle: "hidden" as const,
                  trafficLightPosition: { x: 14, y: 11 }
              }
            : {}),
        minWidth: 640,
        minHeight: 420,
        useContentSize: true,
        webPreferences: {
            contextIsolation: true,
            // https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
            preload: path.join(import.meta.dirname, "electron-preload.cjs")
        }
    });

    /**
     * Read the native window state exposed to the custom title bar.
     */
    const windowState = () => ({ maximized: mainWindow.isMaximized() });

    /**
     * Notify the renderer after the native window changes maximization
     * state.
     */
    const publishWindowState = () => {
        mainWindow.webContents.send("window:state-changed", windowState());
    };

    mainWindow.on("maximize", publishWindowState);
    mainWindow.on("unmaximize", publishWindowState);
    mainWindow.webContents.ipc.handle("window:state", windowState);
    mainWindow.webContents.ipc.handle("window:minimize", () =>
        mainWindow.minimize()
    );
    mainWindow.webContents.ipc.handle("window:toggle-maximize", () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }

        return windowState();
    });
    mainWindow.webContents.ipc.handle("window:close", () => mainWindow.close());

    const scenario = new ScenarioDatabase();
    const imagePlugins = new ImagePlugins(
        path.join(app.getPath("userData"), "plugins"),
        resolveElectronAssetsPath("plugins")
    );

    await imagePlugins.reload();

    // Serialize document actions, including native dialogs and asynchronous backups.
    let pending: Promise<unknown> = Promise.resolve();
    let documentActions = 0;
    let closeConfirmed = false;
    let rendererReady = false;

    mainWindow.on("close", event => {
        if (
            !closeConfirmed &&
            rendererReady &&
            !mainWindow.webContents.isDestroyed()
        ) {
            event.preventDefault();
            mainWindow.webContents.send("scenario:flush");

            return;
        }

        if (documentActions) {
            event.preventDefault();
            void pending.then(() => mainWindow.close());
        }
    });
    mainWindow.on("closed", () => scenario.close());
    mainWindow.webContents.ipc.handle("scenario:confirm-close", () => {
        closeConfirmed = true;

        if (quitRequested) {
            // The save-flush close guard canceled the original app.quit().
            // Resume quitting once all document work has finished.
            void pending.then(() => app.quit());
        } else {
            mainWindow.close();
        }
    });

    /**
     * Serialize document operations and keep the window open until queued
     * work has finished.
     */
    function documentAction<T>(action: () => Promise<T> | T): Promise<T> {
        documentActions++;

        const result = pending.then(action).finally(() => {
            documentActions--;
        });

        pending = result.catch(() => undefined);

        return result;
    }

    const preferencesPath = path.join(app.getPath("userData"), "session.json");

    /**
     * Atomically persist the last scenario path used for session
     * restoration.
     */
    async function rememberScenario(filePath: string | null) {
        await writeFile(
            `${preferencesPath}.tmp`,
            JSON.stringify({ lastScenario: filePath }),
            "utf8"
        );
        await rename(`${preferencesPath}.tmp`, preferencesPath);
    }

    /**
     * Create loading placeholders for saved image windows before their
     * readers finish.
     */
    function restoreWorkspace(info: ScenarioInfo): ScenarioInfo {
        return {
            ...info,
            workspace: scenario.readWorkspace().map(saved => ({
                ...saved,
                loading: true,
                image: {
                    name: path.basename(saved.path),
                    path: saved.path,
                    pluginId: saved.pluginId,
                    pluginName: saved.pluginId,
                    ...(saved.metadataFiles?.length
                        ? {
                              attachedMetadata: saved.metadataFiles.map(
                                  file => ({
                                      path: file,
                                      name: path.basename(file)
                                  })
                              )
                          }
                        : {})
                }
            }))
        };
    }

    mainWindow.webContents.ipc.handle("scenario:load-images", () =>
        documentAction(async () => {
            const updates: RestoredImageUpdate[] = [];

            for (const saved of scenario.readWorkspace()) {
                let update;

                try {
                    const image = await imagePlugins.open(
                        saved.path,
                        saved.pluginId,
                        saved.scaling
                    );

                    if (saved.metadataFiles?.length) {
                        image.attachedMetadata = await Promise.all(
                            saved.metadataFiles.map(readMetadata)
                        );
                    }

                    update = { id: saved.id, image };
                } catch (cause) {
                    update = {
                        id: saved.id,
                        error:
                            cause instanceof Error
                                ? cause.message
                                : "Unable to restore image."
                    };
                }

                updates.push(update);

                if (!mainWindow.webContents.isDestroyed()) {
                    mainWindow.webContents.send(
                        "scenario:image-restored",
                        update
                    );
                }
            }

            return updates;
        })
    );
    mainWindow.webContents.ipc.handle(
        "scenario:workspace",
        (_event, filePath: string, windows: unknown) =>
            documentAction(async () => {
                if (scenario.current?.path !== filePath) {
                    throw new Error(
                        "The scenario has changed; workspace was not saved."
                    );
                }

                await scenario.saveWorkspace(windows);
            })
    );
    mainWindow.webContents.ipc.handle("scenario:restore-last", () =>
        documentAction(async () => {
            rendererReady = true;

            if (scenario.current) {
                return restoreWorkspace(scenario.current);
            }

            let lastScenario: unknown;

            try {
                lastScenario = JSON.parse(
                    await readFile(preferencesPath, "utf8")
                ).lastScenario;
            } catch (cause) {
                if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
                    return null;
                }

                throw new Error(
                    "Unable to read the previous application session."
                );
            }

            if (typeof lastScenario !== "string" || !lastScenario) {
                return null;
            }

            try {
                return restoreWorkspace(await scenario.open(lastScenario));
            } catch (cause) {
                scenario.close();

                throw new Error(
                    `Unable to reopen ${lastScenario}: ${cause instanceof Error ? cause.message : String(cause)}`
                );
            }
        })
    );
    mainWindow.webContents.ipc.handle("scenario:new", () =>
        documentAction(async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
                title: "New scenario",
                defaultPath: "Untitled.scenario",
                filters: [
                    { name: "Scenario database", extensions: ["scenario"] }
                ]
            });

            if (result.canceled || !result.filePath) {
                return null;
            }

            let filePath = result.filePath;

            if (!path.extname(filePath)) {
                filePath += ".scenario";
            }

            const created = await scenario.createFile(filePath);

            await rememberScenario(filePath);

            return restoreWorkspace(created);
        })
    );
    mainWindow.webContents.ipc.handle(
        "image:plugins",
        () => imagePlugins.status
    );
    mainWindow.webContents.ipc.handle(
        "plugin:ribbon-action",
        (_event, pluginId: string, actionId: string) =>
            documentAction(() => {
                if (
                    typeof pluginId !== "string" ||
                    typeof actionId !== "string"
                ) {
                    throw new Error("Invalid ribbon action.");
                }

                return imagePlugins.executeRibbonAction(pluginId, actionId, {
                    scenarioPath: scenario.current?.path ?? null
                });
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:region",
        (
            _event,
            filePath: string,
            pluginId: string,
            polygon: PolygonPoint[],
            scaling?: Scaling
        ) =>
            documentAction(() => {
                if (!scenario.current) {
                    throw new Error(
                        "Open a scenario before selecting image regions."
                    );
                }

                return imagePlugins.readRegion(
                    filePath,
                    pluginId,
                    polygon,
                    scaling
                );
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:pixel",
        (
            _event,
            filePath: string,
            pluginId: string,
            row: number,
            column: number,
            scaling?: Scaling
        ) =>
            documentAction(() => {
                if (!scenario.current) {
                    throw new Error(
                        "Open a scenario before inspecting pixels."
                    );
                }

                return imagePlugins.readPixel(
                    filePath,
                    pluginId,
                    row,
                    column,
                    scaling
                );
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:form-sicd",
        (
            _event,
            filePath: string,
            pluginId: string,
            settings: FormationSettings
        ) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before forming an image.");
                }

                const directory = path.join(
                    app.getPath("userData"),
                    "formed-images",
                    randomUUID()
                );

                await mkdir(directory, { recursive: true });

                const outputPath = path.join(
                    directory,
                    `${path.parse(filePath).name}-formed.sicd`
                );

                return imagePlugins.formSicd(
                    filePath,
                    pluginId,
                    outputPath,
                    settings
                );
            })
    );
    const imageSaver = new ImageSaver();

    mainWindow.webContents.ipc.handle(
        "image:save",
        (_event, filePath: string, options: ImageSaveOptions = {}) =>
            documentAction(() =>
                imageSaver.save(
                    filePath,
                    async suggestedPath => {
                        const extension = path
                            .extname(filePath)
                            .slice(1)
                            .toLowerCase();
                        const nativeExtensions = [
                            "sidd",
                            "sicd",
                            "nitf",
                            "ntf"
                        ].includes(extension)
                            ? [...new Set([extension, "nitf", "ntf"])]
                            : [extension];
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: "Save Image",
                            defaultPath: suggestedPath,
                            filters: [
                                {
                                    name: "Supported image formats",
                                    extensions: [
                                        ...new Set([
                                            ...nativeExtensions.filter(Boolean),
                                            ...rasterExportExtensions
                                        ])
                                    ]
                                },
                                { name: "PNG image", extensions: ["png"] },
                                {
                                    name: "JPEG image",
                                    extensions: ["jpg", "jpeg"]
                                },
                                {
                                    name: "TIFF image",
                                    extensions: ["tif", "tiff"]
                                },
                                { name: "BMP image", extensions: ["bmp"] },
                                { name: "WebP image", extensions: ["webp"] }
                            ],
                            properties: [
                                "showOverwriteConfirmation",
                                "createDirectory"
                            ]
                        });

                        return result.canceled
                            ? null
                            : (result.filePath ?? null);
                    },
                    async (source, output) => {
                        const extension = path.extname(output).toLowerCase();
                        const vector = options.pluginId === "nova.vector";
                        const standard = options.pluginId !== "nova.sicd";
                        const raster =
                            vector && options.svgRaster
                                ? nativeImage.createFromDataURL(
                                      options.svgRaster
                                  )
                                : standard
                                  ? nativeImage.createFromPath(source)
                                  : undefined;

                        if (
                            raster &&
                            !raster.isEmpty() &&
                            [".png", ".jpg", ".jpeg"].includes(extension)
                        ) {
                            await writeFile(
                                output,
                                extension === ".png"
                                    ? raster.toPNG()
                                    : raster.toJPEG(95),
                                { flag: "wx" }
                            );
                            return;
                        }

                        if (vector) {
                            if (!raster || raster.isEmpty()) {
                                throw new Error(
                                    "Unable to rasterize the SVG for export."
                                );
                            }

                            const intermediate = `${output}.png`;

                            try {
                                await writeFile(intermediate, raster.toPNG(), {
                                    flag: "wx"
                                });
                                await imagePlugins.exportRaster(
                                    intermediate,
                                    output
                                );
                            } finally {
                                await rm(intermediate, { force: true });
                            }
                        } else {
                            await imagePlugins.exportRaster(
                                source,
                                output,
                                options.scaling
                            );
                        }
                    }
                )
            )
    );
    mainWindow.webContents.ipc.handle(
        "image:crop",
        (_event, filePath: string, pluginId: string, selection: ImageCrop) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before cropping images.");
                }

                const directory = path.join(
                    app.getPath("userData"),
                    "cropped-images",
                    randomUUID()
                );

                await mkdir(directory, { recursive: true });

                return imagePlugins.crop(
                    filePath,
                    pluginId,
                    directory,
                    selection
                );
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:create-sidd",
        (_event, filePath: string, pluginId: string, settings: SiddSettings) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before creating a SIDD.");
                }

                const directory = path.join(
                    app.getPath("userData"),
                    "derived-images",
                    randomUUID()
                );

                await mkdir(directory, { recursive: true });

                const outputPath = path.join(
                    directory,
                    `${path.parse(filePath).name}-detected.sidd`
                );

                return imagePlugins.createSidd(
                    filePath,
                    pluginId,
                    outputPath,
                    settings
                );
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:scaling",
        (_event, filePath: string, pluginId: string, scaling: Scaling) =>
            documentAction(() => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before scaling images.");
                }

                return imagePlugins.rescale(filePath, pluginId, scaling);
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:slice",
        (
            _event,
            filePath: string,
            pluginId: string,
            orientation: SliceOrientation,
            index: number,
            scaling?: Scaling
        ) =>
            documentAction(() => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before slicing images.");
                }

                return imagePlugins.readSlice(
                    filePath,
                    pluginId,
                    orientation,
                    index,
                    scaling
                );
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:attach-metadata",
        (_event, imagePath: string) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error(
                        "Open a scenario before attaching metadata."
                    );
                }

                const result = await dialog.showOpenDialog(mainWindow, {
                    title: "Attach JSON metadata",
                    defaultPath: path.dirname(imagePath),
                    filters: [{ name: "JSON metadata", extensions: ["json"] }],
                    properties: ["openFile", "multiSelections"]
                });

                if (result.canceled || !result.filePaths.length) {
                    return null;
                }

                if (result.filePaths.length > 32) {
                    throw new Error(
                        "Attach at most 32 metadata files per image."
                    );
                }

                const attachments = await Promise.all(
                    result.filePaths.map(readMetadata)
                );
                const failures = attachments.filter(item => item.error);

                if (failures.length) {
                    throw new Error(
                        failures
                            .map(item => `${item.name}: ${item.error}`)
                            .join("\n")
                    );
                }

                return attachments;
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:import",
        (_event, paths?: string | string[]) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error(
                        "Open or create a scenario before opening images."
                    );
                }

                const extensions = new Set(
                    imagePlugins.filters.flatMap(filter => filter.extensions)
                );

                if (!extensions.size) {
                    throw new Error(
                        "Install an image plugin before opening images."
                    );
                }

                const selected =
                    paths === undefined
                        ? await dialog.showOpenDialog(mainWindow, {
                              title: "Add images or ZIP",
                              filters: [
                                  {
                                      name: "Images, ZIP and metadata",
                                      extensions: [...extensions, "zip", "json"]
                                  },
                                  ...imagePlugins.filters,
                                  { name: "ZIP archives", extensions: ["zip"] },
                                  {
                                      name: "JSON metadata",
                                      extensions: ["json"]
                                  }
                              ],
                              properties: ["openFile", "multiSelections"]
                          })
                        : {
                              canceled: false,
                              filePaths:
                                  typeof paths === "string" ? [paths] : paths
                          };

                if (selected.canceled || !selected.filePaths.length) {
                    return { errors: [] };
                }

                if (
                    !Array.isArray(selected.filePaths) ||
                    selected.filePaths.length > 1000 ||
                    !selected.filePaths.every(
                        file => typeof file === "string" && file.length > 0
                    )
                ) {
                    throw new Error("Invalid image selection.");
                }

                const batch = await prepareImport(
                    selected.filePaths,
                    path.join(app.getPath("userData"), "imports"),
                    extensions
                );

                if (batch.entries.length > 1000) {
                    throw new Error("Import at most 1,000 images at a time.");
                }

                const updates: ImageImportUpdate[] = [];

                /**
                 * Publish an image import update and retain it for
                 * reconciliation with the final IPC response.
                 */
                const send = (update: ImageImportUpdate) => {
                    updates.push(update);

                    if (!mainWindow.webContents.isDestroyed()) {
                        mainWindow.webContents.send(
                            "image:import-update",
                            update
                        );
                    }
                };

                for (const [index, entry] of batch.entries.entries()) {
                    const key = `${index}:${entry.filePath}`;
                    const loading: ImageInfo = {
                        name: path.basename(entry.filePath),
                        path: entry.filePath,
                        pluginId: "",
                        pluginName: "Loading…"
                    };

                    send({ key, status: "loading", image: loading });

                    try {
                        const image = await imagePlugins.open(entry.filePath);

                        if (entry.metadata.length) {
                            image.attachedMetadata = entry.metadata;
                        }

                        send({ key, status: "ready", image });
                    } catch (cause) {
                        const error =
                            cause instanceof Error
                                ? cause.message
                                : String(cause);

                        batch.errors.push(`${loading.name}: ${error}`);
                        send({ key, status: "error", error });
                    }
                }

                return { errors: batch.errors, updates };
            })
    );
    mainWindow.webContents.ipc.handle(
        "image:open",
        (_event, droppedPath?: string) =>
            documentAction(async () => {
                if (!scenario.current) {
                    throw new Error(
                        "Open or create a scenario before opening images."
                    );
                }

                if (!imagePlugins.filters.length) {
                    throw new Error(
                        "Install an image plugin before opening images."
                    );
                }

                const result =
                    droppedPath === undefined
                        ? await dialog.showOpenDialog(mainWindow, {
                              title: "Open image",
                              filters: imagePlugins.filters,
                              properties: ["openFile"]
                          })
                        : { canceled: false, filePaths: [droppedPath] };
                const filePath = result.filePaths[0];

                if (result.canceled || !filePath) {
                    return null;
                }

                mainWindow.webContents.send("image:loading", {
                    name: path.basename(filePath),
                    path: filePath,
                    pluginId: "",
                    pluginName: "Loading…"
                });

                return imagePlugins.open(filePath);
            })
    );
    mainWindow.webContents.ipc.handle(
        "scenario:open",
        (_event, droppedPath?: string) =>
            documentAction(async () => {
                const result =
                    droppedPath === undefined
                        ? await dialog.showOpenDialog(mainWindow, {
                              title: "Open scenario",
                              filters: [
                                  {
                                      name: "Scenario database",
                                      extensions: ["scenario"]
                                  }
                              ],
                              properties: ["openFile"]
                          })
                        : { canceled: false, filePaths: [droppedPath] };
                const filePath = result.filePaths[0];

                if (result.canceled || !filePath) {
                    return null;
                }

                const opened = await scenario.open(filePath);

                await rememberScenario(filePath);

                return restoreWorkspace(opened);
            })
    );
    mainWindow.webContents.ipc.handle(
        "scenario:read",
        (_event, table: string, offset: number) =>
            scenario.readTable(table, offset)
    );
    mainWindow.webContents.ipc.handle("scenario:close", () =>
        documentAction(async () => {
            await rememberScenario(null);
            scenario.close();
        })
    );

    if (import.meta.env.QUASAR_DEV) {
        await mainWindow.loadURL(import.meta.env.QUASAR_APP_URL);
    } else {
        await mainWindow.loadFile("index.html");
    }

    if (import.meta.env.QUASAR_DEBUG) {
        // if on DEV or Production with debug enabled
        mainWindow.webContents.openDevTools();
    } else {
        // we're on production; no access to devtools pls
        mainWindow.webContents.on("devtools-opened", () => {
            mainWindow?.webContents.closeDevTools();
        });
    }
}

void app.whenReady().then(() => {
    registerQuasarRuntime();

    if (platform === "darwin") {
        app.dock?.setIcon(resolveElectronAssetsPath("icons/nova.png"));
    }

    void createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (quitRequested || platform !== "darwin") {
        app.quit();
    }
});
