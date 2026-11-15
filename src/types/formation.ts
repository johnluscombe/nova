/**
 * Settings for experimental CPHD-to-SICD CPU backprojection; these control the
 * output grid and sampled aperture.
 */
export interface FormationSettings {
    algorithm: "backprojection";

    /** Square output side length in pixels: 64, 128, 256, or 512. */
    imageSize: number;

    /** Output sample spacing in meters; zero requests automatic spacing. */
    pixelSpacing: number;

    /** Maximum number of aperture vectors used for backprojection (8–4096). */
    maxVectors: number;

    /** Aperture weighting applied during formation. */
    window: "hann" | "uniform";
}

export const defaultFormationSettings: FormationSettings = {
    algorithm: "backprojection",
    imageSize: 256,
    pixelSpacing: 0,
    maxVectors: 512,
    window: "hann"
};

/**
 * Validate supported backprojection settings and return a detached
 * settings object.
 */
export function validateFormationSettings(value: unknown): FormationSettings {
    const settings = value as FormationSettings | null;

    if (
        !settings ||
        settings.algorithm !== "backprojection" ||
        ![64, 128, 256, 512].includes(settings.imageSize) ||
        !Number.isFinite(settings.pixelSpacing) ||
        settings.pixelSpacing < 0 ||
        settings.pixelSpacing > 1000 ||
        !Number.isSafeInteger(settings.maxVectors) ||
        settings.maxVectors < 8 ||
        settings.maxVectors > 4096 ||
        !["hann", "uniform"].includes(settings.window)
    ) {
        throw new Error(
            "Choose a valid image size, spacing (0–1000 m), aperture length (8–4096 vectors), and window."
        );
    }

    return {
        algorithm: settings.algorithm,
        imageSize: settings.imageSize,
        pixelSpacing: settings.pixelSpacing,
        maxVectors: settings.maxVectors,
        window: settings.window
    };
}

/**
 * A diagnostic slide produced during image formation; the final slide has the
 * identifier "final".
 */
export interface FormationProduct {
    id: string;

    title: string;

    description: string;

    previewDataUrl: string;
}

/**
 * Validate bounded PNG diagnostic previews with unique identifiers and a
 * final-image slide.
 */
export function validateFormationProducts(value: unknown): FormationProduct[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
        throw new Error("Invalid formation products.");
    }

    const ids = new Set<string>();
    const products = value.map((item: FormationProduct) => {
        if (
            !item ||
            typeof item.id !== "string" ||
            !/^[a-z][a-z0-9-]{0,40}$/.test(item.id) ||
            ids.has(item.id) ||
            typeof item.title !== "string" ||
            !item.title.trim() ||
            item.title.length > 100 ||
            typeof item.description !== "string" ||
            item.description.length > 2000 ||
            typeof item.previewDataUrl !== "string" ||
            item.previewDataUrl.length > 2 * 1024 * 1024 ||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(
                item.previewDataUrl
            )
        ) {
            throw new Error("Invalid formation product preview.");
        }

        ids.add(item.id);

        return {
            id: item.id,
            title: item.title,
            description: item.description,
            previewDataUrl: item.previewDataUrl
        };
    });

    if (products.at(-1)?.id !== "final") {
        throw new Error("Formation products must end with the final image.");
    }

    return products;
}
