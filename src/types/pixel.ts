/**
 * One scalar sample in the requested scaling, together with a human-readable
 * quantity/unit label.
 */
export interface PixelData {
    /** Finite sample value, or null when the selected quantity is undefined. */
    value: number | null;

    valueLabel: string;
}

/**
 * Zero-based integer row and column indices of a source pixel, independent of
 * preview dimensions.
 */
export interface PixelPosition {
    row: number;

    column: number;
}
