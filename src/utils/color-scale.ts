import { validateColorScale, type ColorScale } from "../types/color-scale";

/** Interpolate RGB stops at a normalized position, clipping to the palette endpoints. */
export function paletteColor(colors: string[], fraction: number): number[] {
    const position = Math.max(0, Math.min(1, fraction)) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(position));
    const mix = position - index;
    const channel = (color: string, offset: number) =>
        parseInt(color.slice(offset, offset + 2), 16);

    return [1, 3, 5].map(offset =>
        Math.round(
            channel(colors[index]!, offset) * (1 - mix) +
                channel(colors[index + 1]!, offset) * mix
        )
    );
}

/** Map RGBA pixels by Rec. 709 luminance while preserving transparency. */
export function colorizePixels(
    pixels: Uint8ClampedArray,
    value: ColorScale
): void {
    const scale = validateColorScale(value);
    const low = scale.minimum ?? 0;
    const high = scale.maximum ?? 255;

    if (low >= high) {
        throw new Error("The color scale minimum must be below its maximum.");
    }

    const stops = scale.colors.map(color =>
        [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))
    );

    for (let i = 0; i < pixels.length; i += 4) {
        const luminance =
            pixels[i]! * 0.2126 +
            pixels[i + 1]! * 0.7152 +
            pixels[i + 2]! * 0.0722;
        const position =
            Math.max(0, Math.min(1, (luminance - low) / (high - low))) *
            (stops.length - 1);
        const index = Math.min(stops.length - 2, Math.floor(position));
        const mix = position - index;

        for (let channel = 0; channel < 3; channel++) {
            pixels[i + channel] = Math.round(
                stops[index]![channel]! * (1 - mix) +
                    stops[index + 1]![channel]! * mix
            );
        }
    }
}

/** Color a display preview without changing the source used for pixel inspection and statistics. */
export async function colorizePreview(
    source: string,
    scale: ColorScale
): Promise<string> {
    const image = new Image();

    image.src = source;
    await image.decode();

    const canvas = document.createElement("canvas");

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");

    if (!context || !canvas.width || !canvas.height) {
        throw new Error("Unable to apply the color scale.");
    }

    context.drawImage(image, 0, 0);

    const data = context.getImageData(0, 0, canvas.width, canvas.height);

    colorizePixels(data.data, scale);
    context.putImageData(data, 0, 0);

    const result = canvas.toDataURL("image/png");

    if (!result.startsWith("data:image/png;base64,")) {
        throw new Error("The image exceeds supported color scale dimensions.");
    }

    return result;
}
