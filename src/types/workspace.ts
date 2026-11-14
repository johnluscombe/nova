import type { ImageInfo } from "./image";
export interface SavedImageWindow {
    id: number;
    path: string;
    pluginId: string;
    rect: { x: number; y: number; width: number; height: number };
    minimized: boolean;
    maximized: boolean;
    z: number;
}
export interface RestoredImageWindow extends SavedImageWindow {
    image: ImageInfo;
    error?: string;
    loading?: boolean;
}
export function validateWorkspace(value: unknown): SavedImageWindow[] {
    if (!Array.isArray(value) || value.length > 1000) {
        throw new Error("Invalid scenario workspace.");
    }
    const ids = new Set<number>();
    for (const item of value) {
        if (
            !item ||
            !Number.isSafeInteger(item.id) ||
            item.id < 1 ||
            ids.has(item.id) ||
            typeof item.path !== "string" ||
            !item.path ||
            typeof item.pluginId !== "string" ||
            !item.pluginId ||
            typeof item.minimized !== "boolean" ||
            typeof item.maximized !== "boolean" ||
            !Number.isSafeInteger(item.z) ||
            item.z < 0 ||
            !item.rect ||
            ![
                item.rect.x,
                item.rect.y,
                item.rect.width,
                item.rect.height
            ].every(Number.isFinite) ||
            item.rect.x < 0 ||
            item.rect.y < 0 ||
            item.rect.width <= 0 ||
            item.rect.height <= 0
        ) {
            throw new Error("Invalid scenario window state.");
        }
        ids.add(item.id);
    }
    return value as SavedImageWindow[];
}

export interface ImageWorkspaceAPI {
    add(image: ImageInfo, loading?: boolean): number;
    complete(id: number, image: ImageInfo): void;
    fail(id: number, message: string): void;
    snapshot(): SavedImageWindow[];
    hydrate(saved: RestoredImageWindow[]): void;
    toggleMetadata(): void;
    toggleStatistics(): void;
}
