/** Display mapping of scalar values to an ordered sequence of RGB color stops. */
export interface ColorScale {
    /** Lower clipping limit in the selected quantity's units; null uses automatic limits. */
    minimum: number | null;

    /** Upper clipping limit in the selected quantity's units; null uses automatic limits. */
    maximum: number | null;

    /** Evenly spaced colors from low to high, each encoded as #RRGGBB. */
    colors: string[];
}

export const colorPalettes = [
    { label: "Grayscale", colors: ["#000000", "#ffffff"] },
    {
        label: "Viridis",
        colors: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"]
    },
    {
        label: "Inferno",
        colors: ["#000004", "#57106e", "#bc3754", "#f98e09", "#fcffa4"]
    },
    {
        label: "Rainbow",
        colors: [
            "#8000ff",
            "#0000ff",
            "#00ffff",
            "#00ff00",
            "#ffff00",
            "#ff8000",
            "#ff0000"
        ]
    },
    { label: "Blue–white–red", colors: ["#2166ac", "#f7f7f7", "#b2182b"] }
];

/** Validate finite clipping limits and 2–8 color stops, returning detached settings. */
export function validateColorScale(value: unknown): ColorScale {
    const scale = value as ColorScale | null;

    if (
        !scale ||
        ![scale.minimum, scale.maximum].every(
            limit =>
                limit === null ||
                (typeof limit === "number" && Number.isFinite(limit))
        ) ||
        (scale.minimum !== null &&
            scale.maximum !== null &&
            scale.minimum >= scale.maximum) ||
        !Array.isArray(scale.colors) ||
        scale.colors.length < 2 ||
        scale.colors.length > 8 ||
        !scale.colors.every(
            color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
        )
    ) {
        throw new Error(
            "Choose finite limits with minimum below maximum and 2–8 valid colors."
        );
    }

    return {
        minimum: scale.minimum,
        maximum: scale.maximum,
        colors: [...scale.colors]
    };
}
