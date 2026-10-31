export interface WindowState {
    maximized: boolean;
}

export interface WindowControlsAPI {
    readonly platform: string;
    getState(): Promise<WindowState>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<WindowState>;
    close(): Promise<void>;
    onStateChanged(callback: (state: WindowState) => void): () => void;
}

declare global {
    interface Window {
        windowControls?: WindowControlsAPI;
    }
}
