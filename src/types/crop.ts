/**
 * Source-pixel rectangle with inclusive left/top and exclusive right/bottom
 * edges.
 */
export interface ImageCrop {
    left: number;

    top: number;

    width: number;

    height: number;

    sourceWidth: number;

    sourceHeight: number;
}

/**
 * Validate integer source-pixel crop bounds and return a detached selection.
 *
 * @param width - Authoritative reader width, when known; otherwise use the
 * supplied source width.
 * @param height - Authoritative reader height, when known.
 * @throws Error if the rectangle is empty, fractional, or outside the source
 * grid.
 */
export function validateCrop(
    value: unknown,
    width?: number,
    height?: number
): ImageCrop {
    const crop = value as ImageCrop | null;

    if (
        !crop ||
        ![
            crop.left,
            crop.top,
            crop.width,
            crop.height,
            crop.sourceWidth,
            crop.sourceHeight
        ].every(Number.isSafeInteger) ||
        crop.left < 0 ||
        crop.top < 0 ||
        crop.width < 1 ||
        crop.height < 1 ||
        crop.sourceWidth < 1 ||
        crop.sourceHeight < 1 ||
        crop.left + crop.width > (width ?? crop.sourceWidth) ||
        crop.top + crop.height > (height ?? crop.sourceHeight) ||
        (width !== undefined && width !== crop.sourceWidth) ||
        (height !== undefined && height !== crop.sourceHeight)
    ) {
        throw new Error("Choose a crop rectangle inside the image.");
    }

    return {
        left: crop.left,
        top: crop.top,
        width: crop.width,
        height: crop.height,
        sourceWidth: crop.sourceWidth,
        sourceHeight: crop.sourceHeight
    };
}
