export interface FormationSettings {
    algorithm: "backprojection";
    imageSize: number;
    pixelSpacing: number;
    maxVectors: number;
    window: "hann" | "uniform";
}
export const defaultFormationSettings: FormationSettings = {
    algorithm: "backprojection",
    imageSize: 256,
    pixelSpacing: 0,
    maxVectors: 512,
    window: "hann"
};
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

export interface FormationProduct {
    id: string;
    title: string;
    description: string;
    previewDataUrl: string;
}
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
