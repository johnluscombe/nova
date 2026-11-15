import { test, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const nativeImageMock = vi.hoisted(() => ({
    createFromBuffer: vi.fn<(buffer: Buffer) => NativeImage>()
}));

vi.mock("electron", () => ({ nativeImage: nativeImageMock }));
import type { NativeImage } from "electron";

import raster from "../../src-electron/electron-assets/plugins/raster/index.ts";

afterEach(() => vi.clearAllMocks());
test("raster limits preview width while preserving source dimensions and rejects decode failures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-raster-"));

    try {
        const file = path.join(directory, "image.png");

        await writeFile(file, "fixture bytes");

        const resize = vi.fn(() => ({ toPNG: () => Buffer.from("preview") }));

        nativeImageMock.createFromBuffer.mockReturnValue({
            isEmpty: () => false,
            getSize: () => ({ width: 4096, height: 2048 }),
            resize
        } as unknown as NativeImage);
        expect(await raster.open(file)).toEqual({
            width: 4096,
            height: 2048,
            previewDataUrl: `data:image/png;base64,${Buffer.from("preview").toString("base64")}`
        });
        expect(resize).toHaveBeenCalledWith({ width: 1600 });
        nativeImageMock.createFromBuffer.mockReturnValue({
            isEmpty: () => true
        } as NativeImage);
        await expect(raster.open(file)).rejects.toThrow(/Unable to decode/);
        await expect(
            raster.open(path.join(directory, "missing.png"))
        ).rejects.toThrow();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
