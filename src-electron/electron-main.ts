import type { SliceOrientation } from "../src/types/slice";
import { BrowserWindow, app, dialog } from "electron";
import { ImagePlugins } from "./image-plugins";
import { ScenarioDatabase } from "./scenario-database";
import path from "node:path";
import { readFile, writeFile, rename } from "node:fs/promises";
import type { ScenarioInfo } from "../src/types/scenario";
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

    const windowState = () => ({ maximized: mainWindow.isMaximized() });
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
    function documentAction<T>(action: () => Promise<T> | T): Promise<T> {
        documentActions++;
        const result = pending.then(action).finally(() => {
            documentActions--;
        });
        pending = result.catch(() => undefined);
        return result;
    }
    const preferencesPath = path.join(app.getPath("userData"), "session.json");
    async function rememberScenario(filePath: string | null) {
        await writeFile(
            `${preferencesPath}.tmp`,
            JSON.stringify({ lastScenario: filePath }),
            "utf8"
        );
        await rename(`${preferencesPath}.tmp`, preferencesPath);
    }
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
                    pluginName: saved.pluginId
                }
            }))
        };
    }
    mainWindow.webContents.ipc.handle("scenario:load-images", () =>
        documentAction(async () => {
            for (const saved of scenario.readWorkspace()) {
                let update;
                try {
                    update = {
                        id: saved.id,
                        image: await imagePlugins.open(
                            saved.path,
                            saved.pluginId
                        )
                    };
                } catch (cause) {
                    update = {
                        id: saved.id,
                        error:
                            cause instanceof Error
                                ? cause.message
                                : "Unable to restore image."
                    };
                }
                if (!mainWindow.webContents.isDestroyed()) {
                    mainWindow.webContents.send(
                        "scenario:image-restored",
                        update
                    );
                }
            }
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
        "image:slice",
        (
            _event,
            filePath: string,
            pluginId: string,
            orientation: SliceOrientation,
            index: number
        ) =>
            documentAction(() => {
                if (!scenario.current) {
                    throw new Error("Open a scenario before slicing images.");
                }
                return imagePlugins.readSlice(
                    filePath,
                    pluginId,
                    orientation,
                    index
                );
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
