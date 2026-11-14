import type { RestoredImageUpdate } from "../src/types/scenario";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { quasarRuntime } from "#q-app/electron/preload";
import type { SavedImageWindow } from "../src/types/workspace";
import type { ImageAPI, ImageInfo } from "../src/types/image";
import type {
    WindowControlsAPI,
    WindowState
} from "../src/types/window-controls";

/**
 * Can be used in the renderer process through `window.quasarRuntime`
 */
contextBridge.exposeInMainWorld("quasarRuntime", quasarRuntime);

contextBridge.exposeInMainWorld("images", {
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    slice: (filePath, pluginId, orientation, index) =>
        ipcRenderer.invoke(
            "image:slice",
            filePath,
            pluginId,
            orientation,
            index
        ),
    open: async (onLoading?: (image: ImageInfo) => void, filePath?: string) => {
        const listener = (
            _event: Electron.IpcRendererEvent,
            image: ImageInfo
        ) => onLoading?.(image);
        ipcRenderer.on("image:loading", listener);
        try {
            return await ipcRenderer.invoke("image:open", filePath);
        } finally {
            ipcRenderer.removeListener("image:loading", listener);
        }
    },
    plugins: () => ipcRenderer.invoke("image:plugins"),
    executeRibbonAction: (pluginId: string, actionId: string) =>
        ipcRenderer.invoke("plugin:ribbon-action", pluginId, actionId)
} satisfies ImageAPI);

contextBridge.exposeInMainWorld("windowControls", {
    platform: process.platform,
    getState: () => ipcRenderer.invoke("window:state"),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    onStateChanged: (callback: (state: WindowState) => void) => {
        const listener = (
            _event: Electron.IpcRendererEvent,
            state: WindowState
        ) => callback(state);
        ipcRenderer.on("window:state-changed", listener);
        return () =>
            ipcRenderer.removeListener("window:state-changed", listener);
    }
} satisfies WindowControlsAPI);

contextBridge.exposeInMainWorld("scenario", {
    loadImages: async (onRestored: (update: RestoredImageUpdate) => void) => {
        const listener = (
            _event: Electron.IpcRendererEvent,
            update: RestoredImageUpdate
        ) => onRestored(update);
        ipcRenderer.on("scenario:image-restored", listener);
        try {
            await ipcRenderer.invoke("scenario:load-images");
        } finally {
            ipcRenderer.removeListener("scenario:image-restored", listener);
        }
    },
    restoreLast: () => ipcRenderer.invoke("scenario:restore-last"),
    saveWorkspace: (path: string, windows: SavedImageWindow[]) =>
        ipcRenderer.invoke("scenario:workspace", path, windows),
    onFlushRequested: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("scenario:flush", listener);
        return () => ipcRenderer.removeListener("scenario:flush", listener);
    },
    confirmClose: () => ipcRenderer.invoke("scenario:confirm-close"),
    create: () => ipcRenderer.invoke("scenario:new"),
    open: (filePath?: string) => ipcRenderer.invoke("scenario:open", filePath),
    readTable: (table: string, offset: number) =>
        ipcRenderer.invoke("scenario:read", table, offset),
    close: () => ipcRenderer.invoke("scenario:close")
});
