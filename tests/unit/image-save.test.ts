import { test, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImageSaver } from "../../src-electron/image-save";

test("saves native bytes and prompts for every destination, including after cancellation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-save-"));

    try {
        const source = path.join(directory, "source.sicd");
        const first = path.join(directory, "first.sicd");
        const second = path.join(directory, "second.sicd");
        const bytes = Buffer.from([0, 255, 128, 1, 0]);
        const saver = new ImageSaver();
        let prompts = 0;
        const choose = async () => {
            prompts++;
            return first;
        };

        await writeFile(source, bytes);
        expect(await saver.save(source, choose)).toBe(first);
        expect(await readFile(first)).toEqual(bytes);
        await writeFile(first, "replace this");
        expect(await saver.save(source, choose)).toBe(first);
        expect(prompts).toBe(2);
        expect(await readFile(first)).toEqual(bytes);
        expect(await saver.save(source, async () => null)).toBeNull();
        expect(await saver.save(source, choose)).toBe(first);
        expect(prompts).toBe(3);
        expect(await saver.save(source, async () => second)).toBe(second);
        expect(await readFile(second)).toEqual(bytes);
        expect(await saver.save(source, async () => second)).toBe(second);
        expect(await readFile(source)).toEqual(bytes);
        expect(
            (await readdir(directory)).some(name =>
                name.startsWith(".nova-save-")
            )
        ).toBe(false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("handles cancellation, invalid sources, mismatched extensions, and failed writes without modifying the source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-save-"));

    try {
        const source = path.join(directory, "source.tif");
        const saver = new ImageSaver();
        const bytes = Buffer.from("native TIFF fixture bytes");

        await writeFile(source, bytes);
        expect(await saver.save(source, async () => null)).toBeNull();
        await expect(
            saver.save("relative.tif", async () => null)
        ).rejects.toThrow("valid source");
        await expect(saver.save(directory, async () => null)).rejects.toThrow(
            "not a file"
        );
        await expect(
            saver.save(path.join(directory, "missing.tif"), async () => null)
        ).rejects.toThrow();
        await expect(
            saver.save(source, async () => path.join(directory, "wrong.png"))
        ).rejects.toThrow("original .tif extension");
        const occupied = path.join(directory, "occupied.tif");
        const { mkdir } = await import("node:fs/promises");

        await mkdir(occupied);
        await expect(
            saver.save(source, async () => occupied)
        ).rejects.toThrow();
        expect(
            (await readdir(directory)).some(name =>
                name.startsWith(".nova-save-")
            )
        ).toBe(false);
        expect(await saver.save(source, async () => source)).toBe(source);
        expect(await readFile(source)).toEqual(bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("allows NITF container suffixes only after verifying the source header", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-save-nitf-"));

    try {
        const saver = new ImageSaver();
        const bytes = Buffer.concat([
            Buffer.from("NITF02.10"),
            Buffer.from([0, 255, 128])
        ]);

        for (const extension of ["sidd", "sicd", "ntf"]) {
            const source = path.join(directory, `source.${extension}`);
            const target = path.join(directory, `${extension}.nitf`);

            await writeFile(source, bytes);
            expect(await saver.save(source, async () => target)).toBe(target);
            expect(await readFile(target)).toEqual(bytes);
        }

        const source = path.join(directory, "not-nitf.sidd");
        const target = path.join(directory, "existing.nitf");

        await writeFile(target, "keep existing output");
        for (const contents of ["<SIDD/>", "NITF", "NITF02.00"]) {
            await writeFile(source, contents);
            await expect(
                saver.save(source, async () => target)
            ).rejects.toThrow("not a NITF 2.1 container");
            expect(await readFile(target, "utf8")).toBe("keep existing output");
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("converts to the target format atomically and preserves existing outputs on conversion failure", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-save-convert-"));

    try {
        const source = path.join(directory, "source.sidd");
        const output = path.join(directory, "output.png");
        const saver = new ImageSaver();
        let conversions = 0;
        const convert = async (_source: string, temporary: string) => {
            expect(path.extname(temporary)).toBe(".png");
            conversions++;
            await writeFile(temporary, "converted PNG bytes");
        };

        await writeFile(source, "unchanged original");
        await writeFile(output, "existing image");
        await expect(
            saver.save(
                source,
                async () => output,
                async (_source, temporary) => {
                    await writeFile(temporary, "partial data");
                    throw Error("Encoder failed");
                }
            )
        ).rejects.toThrow("Encoder failed");
        expect(await readFile(output, "utf8")).toBe("existing image");
        expect(
            (await readdir(directory)).some(name =>
                name.startsWith(".nova-save-")
            )
        ).toBe(false);
        await saver.save(source, async () => output, convert);
        expect(await readFile(output, "utf8")).toBe("converted PNG bytes");
        await saver.save(source, async () => output, convert);
        expect(conversions).toBe(2);
        expect(await readFile(source, "utf8")).toBe("unchanged original");
        await expect(
            saver.save(
                source,
                async () => path.join(directory, "invalid.exe"),
                convert
            )
        ).rejects.toThrow("Format conversion is not supported");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("color-mapped raster saves encode even when the extension matches and protect the source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-save-color-"));

    try {
        const source = path.join(directory, "source.png");
        const output = path.join(directory, "colored.png");
        const saver = new ImageSaver();
        const convert = async (_source: string, temporary: string) => {
            await writeFile(temporary, "colored");
        };

        await writeFile(source, "original");
        await saver.save(source, async () => output, convert, true);
        expect(await readFile(output, "utf8")).toBe("colored");
        expect(await readFile(source, "utf8")).toBe("original");
        await expect(
            saver.save(source, async () => source, convert, true)
        ).rejects.toThrow("different filename");
        expect(await readFile(source, "utf8")).toBe("original");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
