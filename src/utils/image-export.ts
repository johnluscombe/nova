/** Rasterize an SVG image at its intrinsic size without including workspace overlays. */
export async function rasterizeSvg(source: string): Promise<string> {
    const image = new Image();

    image.src = source;
    await image.decode();

    const canvas = document.createElement("canvas");

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");

    if (!context || !canvas.width || !canvas.height) {
        throw new Error("Unable to rasterize this SVG.");
    }

    context.drawImage(image, 0, 0);

    const result = canvas.toDataURL("image/png");

    if (!result.startsWith("data:image/png;base64,")) {
        throw new Error(
            "This SVG exceeds the supported raster export dimensions."
        );
    }

    return result;
}
