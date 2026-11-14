import { test, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: vi.fn() } }));
import { nativeImage } from "electron";
import raster from "../../src-electron/electron-assets/plugins/raster/index.mjs";

afterEach(() => vi.clearAllMocks());
test("raster limits preview width while preserving source dimensions and rejects decode failures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-raster-"));
    try {
        const file = path.join(directory, "image.png");
        await writeFile(file, "fixture bytes");
        const resize = vi.fn(() => ({ toPNG: () => Buffer.from("preview") }));
        nativeImage.createFromBuffer.mockReturnValue({
            isEmpty: () => false,
            getSize: () => ({ width: 4096, height: 2048 }),
            resize
        });
        expect(await raster.open(file)).toEqual({
            width: 4096,
            height: 2048,
            previewDataUrl: `data:image/png;base64,${Buffer.from("preview").toString("base64")}`
        });
        expect(resize).toHaveBeenCalledWith({ width: 1600 });
        nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => true });
        await expect(raster.open(file)).rejects.toThrow(/Unable to decode/);
        await expect(
            raster.open(path.join(directory, "missing.png"))
        ).rejects.toThrow();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
