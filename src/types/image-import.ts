import type { ImageInfo } from "./image";
export interface ImageImportUpdate {
    key: string;
    status: "loading" | "ready" | "error";
    image?: ImageInfo;
    error?: string;
}
export interface ImageImportResult {
    errors: string[];
    updates?: ImageImportUpdate[];
}
