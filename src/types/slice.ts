/** Horizontal selects one source row; vertical selects one source column. */
export type SliceOrientation = "horizontal" | "vertical";

/**
 * Ordered scalar samples for a line graph. Readers return pixel indices; the
 * renderer may convert positions to physical coordinates.
 */
export interface SliceData {
    /** Ordered positions and values; null values create gaps in the graph. */
    points: {
        position: number;

        value: number | null;
    }[];

    /** Horizontal-axis quantity and units after any coordinate conversion. */
    positionLabel: string;

    /** Vertical-axis quantity and units for the selected sample scaling. */
    valueLabel: string;
}

/** A source-grid row or column selected for line analysis. */
export interface SliceSelection {
    orientation: SliceOrientation;

    /** Zero-based row for horizontal slices, or column for vertical slices. */
    index: number;
}
