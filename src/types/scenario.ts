import type { ImageInfo } from "./image";
import type { RestoredImageWindow, SavedImageWindow } from "./workspace";
export interface ScenarioInfo {
    name: string;
    path: string | null;
    tables: string[];
    workspace?: RestoredImageWindow[];
}

export interface ScenarioRows {
    columns: string[];
    rows: Record<string, string | number | null>[];
    hasMore: boolean;
}

export interface RestoredImageUpdate {
    id: number;
    image?: ImageInfo;
    error?: string;
}

export interface ScenarioAPI {
    loadImages(
        onRestored: (update: RestoredImageUpdate) => void
    ): Promise<void>;
    restoreLast(): Promise<ScenarioInfo | null>;
    saveWorkspace(path: string, windows: SavedImageWindow[]): Promise<void>;
    onFlushRequested(callback: () => void): () => void;
    confirmClose(): Promise<void>;
    create(): Promise<ScenarioInfo | null>;
    open(): Promise<ScenarioInfo | null>;
    readTable(table: string, offset: number): Promise<ScenarioRows>;
    close(): Promise<void>;
}

declare global {
    interface Window {
        scenario: ScenarioAPI;
    }
}
