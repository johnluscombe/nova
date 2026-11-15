/**
 * An affine coordinate mapping for one source dimension: coordinate = origin +
 * pixel index × spacing.
 */
export interface ImageAxis {
    /** Display name, such as Down range, Cross range, or Row. */
    label: string;

    /** Meters for physical coordinates, or pixels for an index axis. */
    unit: "m" | "pixel";

    /** Coordinate at the center of source pixel zero. */
    origin: number;

    /**
     * Signed coordinate increment per source pixel; must be finite and
     * nonzero.
     */
    spacing: number;
}

/**
 * Independent row and column coordinate mappings for the original source grid,
 * unaffected by preview resizing.
 */
export interface ImageAxes {
    /** Mapping along increasing source row indices (vertical direction). */
    row: ImageAxis;

    /**
     * Mapping along increasing source column indices (horizontal direction).
     */
    column: ImageAxis;
}

/**
 * Validate axis labels, units, and finite nonzero sample spacing for both
 * source dimensions.
 */
export function validateImageAxes(value: unknown): ImageAxes {
    const axes = value as ImageAxes | null;

    if (
        !axes ||
        ![axes.row, axes.column].every(
            axis =>
                axis &&
                typeof axis.label === "string" &&
                axis.label.trim().length > 0 &&
                axis.label.length <= 100 &&
                ["m", "pixel"].includes(axis.unit) &&
                Number.isFinite(axis.origin) &&
                Number.isFinite(axis.spacing) &&
                axis.spacing !== 0
        )
    ) {
        throw new Error("Invalid image axes.");
    }

    return axes;
}

/**
 * Convert a zero-based source pixel center to its axis coordinate.
 */
export function axisCoordinate(axis: ImageAxis, index: number): number {
    return axis.origin + index * axis.spacing;
}

/**
 * Choose a small set of labeled source positions appropriate for the
 * available display extent.
 */
export function axisTicks(axis: ImageAxis, length: number, extent: number) {
    if (!Number.isSafeInteger(length) || length < 1 || extent <= 0) {
        return [];
    }

    const count =
        length === 1
            ? 1
            : Math.min(5, length, Math.max(2, Math.floor(extent / 75) + 1));

    return Array.from({ length: count }, (_, i) => {
        const index =
            count === 1 ? 0 : Math.round((i * (length - 1)) / (count - 1));

        return {
            fraction: (index + 0.5) / length,
            value: axisCoordinate(axis, index)
        };
    });
}
