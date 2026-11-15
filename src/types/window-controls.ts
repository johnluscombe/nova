/** Native Electron window state used by the application title-bar controls. */
export interface WindowState {
    maximized: boolean;
}

/**
 * Preload bridge for native desktop window actions and maximization
 * notifications.
 */
export interface WindowControlsAPI {
    /** Node platform identifier used to choose native title-bar conventions. */
    readonly platform: string;

    /**
     * Read the native maximization state.
     */
    getState(): Promise<WindowState>;

    /**
     * Minimize the native desktop window.
     */
    minimize(): Promise<void>;

    /**
     * Toggle the native window between maximized and restored sizes.
     */
    toggleMaximize(): Promise<WindowState>;

    /**
     * Request a native close, allowing the scenario save guard to finish.
     */
    close(): Promise<void>;

    /**
     * Subscribe to native maximization updates and return an unsubscribe
     * function.
     */
    onStateChanged(callback: (state: WindowState) => void): () => void;
}

declare global {
    /** Electron preload additions to the renderer browser window. */
    interface Window {
        windowControls?: WindowControlsAPI;
    }
}
