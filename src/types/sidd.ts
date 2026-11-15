export interface SiddSettings {
    version: 2 | 3;
    bitDepth: 8 | 16;
    contrast: "density" | "linear" | "logarithmic";
    interpolation: "nearest" | "bilinear";
    pixelSpacing: number;
}
export const defaultSiddSettings: SiddSettings = {
    version: 3,
    bitDepth: 8,
    contrast: "density",
    interpolation: "nearest",
    pixelSpacing: 0
};
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
