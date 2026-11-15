import type { ImageImportUpdate } from "../src/types/image-import";
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
    save: (filePath, options) =>
        ipcRenderer.invoke("image:save", filePath, options),
    region: (filePath, pluginId, polygon, scaling) =>
        ipcRenderer.invoke(
            "image:region",
            filePath,
            pluginId,
            polygon,
            scaling
        ),
    attachMetadata: imagePath =>
        ipcRenderer.invoke("image:attach-metadata", imagePath),
    importFiles: async (onUpdate, paths) => {
        const seen = new Set<string>();

        /**
         * Deliver each progress state once while reconciling IPC events
         * with the final invocation result.
         */
        const deliver = (update: ImageImportUpdate) => {
            const key = `${update.key}:${update.status}`;

            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            onUpdate(update);
        };

        /**
         * Forward an IPC event payload to the renderer callback registered
         * for this operation.
         */
        const listener = (
            _event: Electron.IpcRendererEvent,
            update: ImageImportUpdate
        ) => deliver(update);

        ipcRenderer.on("image:import-update", listener);

        try {
            const result = await ipcRenderer.invoke("image:import", paths);

            // The invoke reply and progress events can arrive on separate queues.
            // Reconcile final results before removing the progress listener.
            for (const update of result.updates ?? []) {
                if (
                    update.status === "loading" &&
                    (seen.has(`${update.key}:ready`) ||
                        seen.has(`${update.key}:error`))
                ) {
                    continue;
                }

                deliver(update);
            }

            return { errors: result.errors };
        } finally {
            ipcRenderer.removeListener("image:import-update", listener);
        }
    },
    pixel: (filePath, pluginId, row, column, scaling) =>
        ipcRenderer.invoke(
            "image:pixel",
            filePath,
            pluginId,
            row,
            column,
            scaling
        ),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    crop: (filePath, pluginId, selection) =>
        ipcRenderer.invoke("image:crop", filePath, pluginId, selection),
    createSidd: (filePath, pluginId, settings) =>
        ipcRenderer.invoke("image:create-sidd", filePath, pluginId, settings),
    formSicd: (filePath, pluginId, settings) =>
        ipcRenderer.invoke("image:form-sicd", filePath, pluginId, settings),
    rescale: (filePath, pluginId, scaling) =>
        ipcRenderer.invoke("image:scaling", filePath, pluginId, scaling),
    slice: (filePath, pluginId, orientation, index, scaling) =>
        ipcRenderer.invoke(
            "image:slice",
            filePath,
            pluginId,
            orientation,
            index,
            scaling
        ),
    open: async (onLoading?: (image: ImageInfo) => void, filePath?: string) => {
        /**
         * Forward an IPC event payload to the renderer callback registered
         * for this operation.
         */
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
        /**
         * Forward an IPC event payload to the renderer callback registered
         * for this operation.
         */
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
        const seen = new Set<number>();

        /**
         * Deliver each progress state once while reconciling IPC events
         * with the final invocation result.
         */
        const deliver = (update: RestoredImageUpdate) => {
            if (seen.has(update.id)) {
                return;
            }

            seen.add(update.id);
            onRestored(update);
        };

        /**
         * Forward an IPC event payload to the renderer callback registered
         * for this operation.
         */
        const listener = (
            _event: Electron.IpcRendererEvent,
            update: RestoredImageUpdate
        ) => deliver(update);

        ipcRenderer.on("scenario:image-restored", listener);

        try {
            const updates = await ipcRenderer.invoke("scenario:load-images");

            for (const update of updates ?? []) {
                deliver(update);
            }
        } finally {
            ipcRenderer.removeListener("scenario:image-restored", listener);
        }
    },
    restoreLast: () => ipcRenderer.invoke("scenario:restore-last"),
    saveWorkspace: (path: string, windows: SavedImageWindow[]) =>
        ipcRenderer.invoke("scenario:workspace", path, windows),
    onFlushRequested: (callback: () => void) => {
        /**
         * Forward an IPC event payload to the renderer callback registered
         * for this operation.
         */
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
