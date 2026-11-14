import type { ImagePlugin } from "../../../image-plugins.ts";
import { readFile } from "node:fs/promises";
import { nativeImage } from "electron";

export default {
    async open(filePath) {
        const image = nativeImage.createFromBuffer(await readFile(filePath));
        if (image.isEmpty()) {
            throw new Error("Unable to decode this JPG/PNG image.");
        }
        const { width, height } = image.getSize();
        const preview = image.resize({ width: Math.min(width, 1600) });
        return {
            width,
            height,
            previewDataUrl: `data:image/png;base64,${preview.toPNG().toString("base64")}`
        };
    }
} satisfies ImagePlugin;
