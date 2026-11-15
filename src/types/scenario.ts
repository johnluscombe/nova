import type { ImageInfo } from "./image";
import type { RestoredImageWindow, SavedImageWindow } from "./workspace";

/**
 * Active scenario identity and optional restored window placeholders from its
 * SQLite workspace.
 */
export interface ScenarioInfo {
    name: string;

    /** Native SQLite file path; null when no persistent path is available. */
    path: string | null;

    tables: string[];

    /** Saved windows enriched for incremental image restoration. */
    workspace?: RestoredImageWindow[];
}

/**
 * A page of scenario table data with ordered column names and an indication of
 * remaining rows.
 */
export interface ScenarioRows {
    columns: string[];

    rows: Record<string, string | number | null>[];

    hasMore: boolean;
}

/**
 * Asynchronous restoration result associated with an existing saved window
 * identifier.
 */
export interface RestoredImageUpdate {
    id: number;

    image?: ImageInfo;

    error?: string;
}

/**
 * Renderer-facing SQLite scenario lifecycle and persistence bridge exposed by
 * Electron preload.
 */
export interface ScenarioAPI {
    /**
     * Read saved image references and deliver each restored image or
     * failure through the callback.
     */
    loadImages(
        onRestored: (update: RestoredImageUpdate) => void
    ): Promise<void>;

    /**
     * Restore the last remembered scenario when its file remains
     * available.
     */
    restoreLast(): Promise<ScenarioInfo | null>;

    /**
     * Persist validated image window state to the named scenario file.
     */
    saveWorkspace(path: string, windows: SavedImageWindow[]): Promise<void>;

    /**
     * Subscribe to native close requests that require a workspace save;
     * return an unsubscribe function.
     */
    onFlushRequested(callback: () => void): () => void;

    /**
     * Acknowledge that renderer persistence is complete so the native
     * close can proceed.
     */
    confirmClose(): Promise<void>;

    /**
     * Choose a destination and create a scenario, returning null if the
     * picker is canceled.
     */
    create(): Promise<ScenarioInfo | null>;

    /**
     * Open a supplied scenario path or ask the user to choose a file.
     */
    open(filePath?: string): Promise<ScenarioInfo | null>;

    /**
     * Fetch one page of a declared scenario table at a zero-based row
     * offset.
     */
    readTable(table: string, offset: number): Promise<ScenarioRows>;

    /**
     * Close the active scenario after pending document operations have
     * finished.
     */
    close(): Promise<void>;
}

declare global {
    /** Electron preload additions to the renderer browser window. */
    interface Window {
        scenario: ScenarioAPI;
    }
}
