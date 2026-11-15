import path from "node:path";
import type { ImagePlugin } from "../../../image-plugins.ts";
import { readFile, writeFile } from "node:fs/promises";
import { nativeImage } from "electron";

export default {
    async crop(filePath, directory, selection) {
        const image = nativeImage.createFromBuffer(await readFile(filePath));
        if (image.isEmpty()) {
            throw new Error("Unable to decode the source image.");
        }
        const output = path.join(
            directory,
            `${path.parse(filePath).name}-crop.png`
        );
        const { left: x, top: y, width, height } = selection;
        await writeFile(output, image.crop({ x, y, width, height }).toPNG(), {
            flag: "wx"
        });
        return output;
    },
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
