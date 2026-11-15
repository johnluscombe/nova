import type { ImageInfo } from "../types/image";
import type { PixelData } from "../types/pixel";

/**
 * Sample the displayed preview, without allocating a full-resolution canvas.
 */
export async function previewPixel(
    image: ImageInfo,
    row: number,
    column: number
): Promise<PixelData> {
    if (!image.previewDataUrl) {
        throw new Error("This image has no preview.");
    }

    const decoded = new Image();

    decoded.src = image.previewDataUrl;
    await decoded.decode();

    const width = image.width ?? decoded.naturalWidth;
    const height = image.height ?? decoded.naturalHeight;

    if (
        !Number.isSafeInteger(row) ||
        !Number.isSafeInteger(column) ||
        row < 0 ||
        column < 0 ||
        row >= height ||
        column >= width
    ) {
        throw new Error("Pixel is outside the image.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = canvas.height = 1;

    const context = canvas.getContext("2d");

    if (!context) {
        throw new Error("Pixel sampling is unavailable.");
    }

    const x = Math.min(
        decoded.naturalWidth - 1,
        Math.floor(((column + 0.5) * decoded.naturalWidth) / width)
    );
    const y = Math.min(
        decoded.naturalHeight - 1,
        Math.floor(((row + 0.5) * decoded.naturalHeight) / height)
    );

    context.drawImage(decoded, x, y, 1, 1, 0, 0, 1, 1);

    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;

    return {
        value:
            alpha === 0
                ? null
                : 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!,
        valueLabel: "Preview luminance (0–255)"
    };
}
