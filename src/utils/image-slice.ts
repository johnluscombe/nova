import type { ImageInfo } from "../types/image";
import type { SliceData, SliceOrientation } from "../types/slice";

export async function previewSlice(
    image: ImageInfo,
    orientation: SliceOrientation,
    index: number
): Promise<SliceData> {
    if (!image.previewDataUrl) {
        throw new Error("This image has no preview to slice.");
    }
    const decoded = new Image();
    decoded.src = image.previewDataUrl;
    await decoded.decode();
    const width = image.width ?? decoded.naturalWidth;
    const height = image.height ?? decoded.naturalHeight;
    const limit = orientation === "horizontal" ? height : width;
    if (!Number.isSafeInteger(index) || index < 0 || index >= limit) {
        throw new Error("Slice index is outside the image.");
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(
        1,
        1600 / Math.max(decoded.naturalWidth, decoded.naturalHeight)
    );
    canvas.width = Math.max(1, Math.round(decoded.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(decoded.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Image sampling is unavailable.");
    }
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const horizontal = orientation === "horizontal";
    const fixed = Math.min(
        (horizontal ? canvas.height : canvas.width) - 1,
        Math.floor(
            ((index + 0.5) / limit) *
                (horizontal ? canvas.height : canvas.width)
        )
    );
    const pixels = context.getImageData(
        horizontal ? 0 : fixed,
        horizontal ? fixed : 0,
        horizontal ? canvas.width : 1,
        horizontal ? 1 : canvas.height
    ).data;
    const count = horizontal ? canvas.width : canvas.height;
    const length = horizontal ? width : height;
    const points = Array.from(
        { length: Math.min(length, count) },
        (_, position) => {
            const pixel =
                Math.min(
                    count - 1,
                    Math.floor((position * count) / Math.min(length, count))
                ) * 4;
            return {
                position: Math.floor(
                    (position * length) / Math.min(length, count)
                ),
                value:
                    pixels[pixel + 3] === 0
                        ? null
                        : 0.2126 * pixels[pixel]! +
                          0.7152 * pixels[pixel + 1]! +
                          0.0722 * pixels[pixel + 2]!
            };
        }
    );
    return {
        points,
        positionLabel: horizontal ? "Column (pixel)" : "Row (pixel)",
        valueLabel: "Preview luminance (0–255)"
    };
}

/** Map a selector position to the source pixel, excluding letterboxed margins. */
export function sliceAtOffset(
    offset: number,
    start: number,
    extent: number,
    length: number
): number | null {
    if (
        !Number.isFinite(offset) ||
        !Number.isFinite(start) ||
        !Number.isFinite(extent) ||
        extent <= 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        offset < start ||
        offset >= start + extent
    ) {
        return null;
    }
    return Math.min(
        length - 1,
        Math.floor(((offset - start) / extent) * length)
    );
}
