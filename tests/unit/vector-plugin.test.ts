import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vector from "../../src-electron/electron-assets/plugins/vector/index.ts";

test("vector rejects non-SVG content and oversized source files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-vector-"));
    try {
        const file = path.join(directory, "test.svg");
        await writeFile(file, "not SVG");
        await expect(vector.open(file)).rejects.toThrow(
            /does not contain an SVG/
        );
        await writeFile(file, Buffer.alloc(16 * 1024 * 1024 + 1));
        await expect(vector.open(file)).rejects.toThrow(/under 16 MB/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
