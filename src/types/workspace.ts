import { validatePolygon, type PolygonPoint } from "./region";
import { isScaling, type Scaling } from "./scaling";
import type { ImageInfo } from "./image";

/**
 * Serializable image-widget state stored in the scenario. Transient loading,
 * statistics, and graph data are excluded.
 */
export interface SavedImageWindow {
    formationProductId?: string;

    /** Closed polygon vertices in source pixel-edge coordinates. */
    region?: PolygonPoint[];

    /**
     * "embedded" or one of metadataFiles, identifying the saved axis
     * preference.
     */
    metadataAxesSource?: string;

    /** Native JSON sidecar paths to reopen with this image. */
    metadataFiles?: string[];

    scaling?: Scaling;

    id: number;

    path: string;

    pluginId: string;

    /** Saved widget geometry in workspace CSS pixels. */
    rect: {
        x: number;

        y: number;

        width: number;

        height: number;
    };

    minimized: boolean;

    maximized: boolean;

    /** Stacking order within the workspace. */
    z: number;
}

/**
 * Saved widget state enriched with decoded image information or a
 * loading/error placeholder during restoration.
 */
export interface RestoredImageWindow extends SavedImageWindow {
    image: ImageInfo;

    error?: string;

    loading?: boolean;
}

/**
 * Validate persisted window identifiers, geometry, source paths, and
 * analysis selections.
 */
export function validateWorkspace(value: unknown): SavedImageWindow[] {
    if (!Array.isArray(value) || value.length > 1000) {
        throw new Error("Invalid scenario workspace.");
    }

    const ids = new Set<number>();

    for (const item of value) {
        if (
            !item ||
            (item.formationProductId !== undefined &&
                (typeof item.formationProductId !== "string" ||
                    !/^[a-z][a-z0-9-]{0,40}$/.test(item.formationProductId))) ||
            (item.metadataFiles !== undefined &&
                (!Array.isArray(item.metadataFiles) ||
                    item.metadataFiles.length > 32 ||
                    !item.metadataFiles.every(
                        (file: unknown) =>
                            typeof file === "string" &&
                            file.length > 0 &&
                            file.length < 8192
                    ))) ||
            (item.metadataAxesSource !== undefined &&
                (typeof item.metadataAxesSource !== "string" ||
                    (item.metadataAxesSource !== "embedded" &&
                        !item.metadataFiles?.includes(
                            item.metadataAxesSource
                        )))) ||
            (item.scaling !== undefined && !isScaling(item.scaling)) ||
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

        if (item.region !== undefined) {
            validatePolygon(
                item.region,
                Number.MAX_SAFE_INTEGER,
                Number.MAX_SAFE_INTEGER
            );
        }

        ids.add(item.id);
    }

    return value as SavedImageWindow[];
}

/**
 * Public workspace controller exposed to the page for window lifecycle and
 * active-image actions.
 */
export interface ImageWorkspaceAPI {
    /** Save or convert the active source image, always choosing a destination. */
    saveImage(): Promise<void>;

    /**
     * Create and activate an image widget; return its session-local window
     * identifier.
     */
    add(image: ImageInfo, loading?: boolean): number;

    /**
     * Populate an existing loading widget and refresh derived state;
     * ignore windows already closed.
     */
    complete(id: number, image: ImageInfo): void;

    /**
     * End loading and retain an error message on the existing widget.
     */
    fail(id: number, message: string): void;

    /**
     * Serialize persistent image windows, excluding transient graphs and
     * unfinished placeholders.
     */
    snapshot(): SavedImageWindow[];

    /**
     * Restore saved widget geometry and selections, then initialize
     * statistics and formation navigation.
     */
    hydrate(saved: RestoredImageWindow[]): void;

    /**
     * Toggle the active image metadata panel; graph windows do not expose
     * image metadata.
     */
    toggleMetadata(): void;

    /**
     * Attach selected JSON files to the active image and resolve any
     * applicable axis definitions.
     */
    attachMetadata(): Promise<void>;

    /**
     * Toggle the active image statistics panel when whole-image or region
     * statistics are available.
     */
    toggleStatistics(): void;

    /**
     * Toggle the interactive slice selectors on the active image.
     */
    toggleSlice(): void;

    /**
     * Toggle source-pixel inspection for pointer movement over the active
     * image.
     */
    togglePixelValues(): void;

    /**
     * Toggle physical or pixel-coordinate axes on the active image.
     */
    toggleAxes(): void;

    /**
     * Toggle rectangular crop selection and leave polygon drawing mode.
     */
    toggleCrop(): void;

    /**
     * Toggle polygon drawing and leave rectangular crop mode.
     */
    togglePolygon(): void;

    /**
     * Invalidate pending region reads and restore the whole-image
     * statistics view.
     */
    clearRegion(): Promise<void>;

    /**
     * Open a loading widget and derive a persistent SIDD from the active
     * source SICD.
     */
    createSidd(): Promise<void>;

    /**
     * Open a loading widget and form a persistent SICD from the active
     * CPHD using saved settings.
     */
    formSicd(): Promise<void>;

    /**
     * Refresh the active image or graph for a supported scaling mode,
     * preserving failures for display.
     */
    setScaling(scaling: Scaling): Promise<void>;
}

/**
 * Active-image capabilities used to choose the contextual ribbon tab and
 * enable product creation.
 */
export interface ImageContext {
    /** Whether the active widget has a ready source file that can be saved. */
    canSave?: boolean;

    canFormSicd?: boolean;

    canCreateSidd?: boolean;

    available: boolean;

    scientific: boolean;
}
