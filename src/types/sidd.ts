/**
 * Detected-product settings used when projecting an opened SICD into a
 * persistent SIDD.
 */
export interface SiddSettings {
    /** SIDD specification version written to the output. */
    version: 2 | 3;

    /** Number of bits per detected output pixel. */
    bitDepth: 8 | 16;

    /** Display remap applied to detected values. */
    contrast: "density" | "linear" | "logarithmic";

    /** Sampling method used for the projected output grid. */
    interpolation: "nearest" | "bilinear";

    /**
     * Ground sample spacing in meters; zero enables automatic sizing within
     * output limits.
     */
    pixelSpacing: number;
}

export const defaultSiddSettings: SiddSettings = {
    version: 3,
    bitDepth: 8,
    contrast: "density",
    interpolation: "nearest",
    pixelSpacing: 0
};

/**
 * Validate SIDD version, display mapping, interpolation, and ground pixel
 * spacing in meters.
 */
export function validateSiddSettings(value: unknown): SiddSettings {
    const settings = value as SiddSettings | null;

    if (
        !settings ||
        ![2, 3].includes(settings.version) ||
        ![8, 16].includes(settings.bitDepth) ||
        !["density", "linear", "logarithmic"].includes(settings.contrast) ||
        !["nearest", "bilinear"].includes(settings.interpolation) ||
        !Number.isFinite(settings.pixelSpacing) ||
        settings.pixelSpacing < 0 ||
        settings.pixelSpacing > 1000
    ) {
        throw new Error(
            "Choose valid SIDD version, bit depth, contrast, interpolation, and pixel spacing (0–1000 m)."
        );
    }

    return {
        version: settings.version,
        bitDepth: settings.bitDepth,
        contrast: settings.contrast,
        interpolation: settings.interpolation,
        pixelSpacing: settings.pixelSpacing
    };
}
