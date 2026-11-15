import type { ImageInfo } from "./image";

/**
 * One incremental import state. The stable key associates loading, ready, and
 * error updates with the same placeholder window.
 */
export interface ImageImportUpdate {
    key: string;

    status: "loading" | "ready" | "error";

    image?: ImageInfo;

    error?: string;
}

/**
 * Import completion summary containing failures and, when supplied, the
 * collected per-image updates.
 */
export interface ImageImportResult {
    errors: string[];

    updates?: ImageImportUpdate[];
}
