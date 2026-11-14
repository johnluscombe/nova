export interface ImageAxis {
    label: string;
    unit: "m" | "pixel";
    /** Coordinate at the center of source pixel zero. */
    origin: number;
    spacing: number;
}
export interface ImageAxes {
    row: ImageAxis;
    column: ImageAxis;
}
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
export function axisCoordinate(axis: ImageAxis, index: number): number {
    return axis.origin + index * axis.spacing;
}
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
