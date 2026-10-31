/**
 * This file is used specifically for security reasons.
 * Here you can securely expose privileged APIs into the renderer process
 * by leveraging Electron's contextBridge functionality and communicating
 * with the main process through Electron's inter-process communication (IPC).
 *
 * WARNING!
 * The preload script sandboxing offers limited access to a full Node.js environment.
 * Do NOT attempt to import packages from node_modules or use Node.js APIs directly in this file.
 * Instead, use IPC to communicate with the main process and access packages and Node.js
 * functionality there.
 *
 * Example on injecting window.myAPI.doAThing() into renderer thread:
 *
 *   import { contextBridge, ipcRenderer } from 'electron'
 *
 *   contextBridge.exposeInMainWorld('myAPI', {
 *     doAThing: () => {}
 *   })
 *
 * Preload script documentation:
 * https://www.electronjs.org/docs/latest/tutorial/tutorial-preload
 */

import { contextBridge, ipcRenderer } from "electron";
import { quasarRuntime } from "#q-app/electron/preload";
import type { SavedImageWindow } from "../src/types/workspace";
import type { ImageAPI } from "../src/types/image";
import type {
    WindowControlsAPI,
    WindowState
} from "../src/types/window-controls";

/**
 * Can be used in the renderer process through `window.quasarRuntime`
 */
contextBridge.exposeInMainWorld("quasarRuntime", quasarRuntime);

contextBridge.exposeInMainWorld("images", {
    open: () => ipcRenderer.invoke("image:open"),
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
    open: () => ipcRenderer.invoke("scenario:open"),
    readTable: (table: string, offset: number) =>
        ipcRenderer.invoke("scenario:read", table, offset),
    close: () => ipcRenderer.invoke("scenario:close")
});
