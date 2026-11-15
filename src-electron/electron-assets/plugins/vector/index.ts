import path from "node:path";
import type { ImagePlugin } from "../../../image-plugins.ts";
import { readFile, writeFile } from "node:fs/promises";

export default {
    async crop(filePath, directory, selection) {
        const source = await readFile(filePath);
        if (source.length > 16 * 1024 * 1024) {
            throw new Error("SVG images must be under 16 MB.");
        }
        const { left, top, width, height, sourceWidth, sourceHeight } =
            selection;
        const output = path.join(
            directory,
            `${path.parse(filePath).name}-crop.svg`
        );
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}"><image width="${sourceWidth}" height="${sourceHeight}" href="data:image/svg+xml;base64,${source.toString("base64")}"/></svg>`;
        await writeFile(output, svg, { flag: "wx" });
        return output;
    },
    async open(filePath) {
        const bytes = await readFile(filePath);
        if (bytes.length > 16 * 1024 * 1024) {
            throw new Error("SVG images must be under 16 MB.");
        }
        const source = bytes.toString("utf8").replace(/^\uFEFF/, "");
        if (!/<svg(?:\s|>)/.test(source)) {
            throw new Error("This file does not contain an SVG image.");
        }
        // Preserve vector resolution; the host uses an img, never inline SVG/HTML.
        return {
            previewDataUrl: `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`
        };
    }
} satisfies ImagePlugin;
