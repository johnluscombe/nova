import type { ImagePlugin } from "../../../image-plugins.ts";
import { readFile } from "node:fs/promises";

export default {
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
