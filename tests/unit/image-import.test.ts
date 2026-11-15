import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
    prepareImport,
    readMetadata,
    matchMetadata,
    extractImages
} from "../../src-electron/image-import";

/**
 * Create and clean up isolated files for an import or metadata association
 * test.
 */
async function fixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-import-"));

    try {
        await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test("metadata matching uses shared JSON, product stems and explicit asset references", () => {
    const one = {
        path: "/metadata/collection.json",
        name: "collection.json",
        data: { sensor: "SAR" }
    };

    expect(matchMetadata("/images/a.tif", [one])).toEqual([one]);

    const json = [
        {
            path: "/metadata/collection_metadata.json",
            name: "collection_metadata.json",
            data: {}
        },
        {
            path: "/metadata/assets.json",
            name: "assets.json",
            data: {
                assets: {
                    image: {
                        href: "https://example.test/files/other.tif?download=1"
                    }
                }
            }
        }
    ];

    expect(matchMetadata("/images/collection_SICD.nitf", json)).toEqual([
        json[0]
    ]);
    expect(matchMetadata("/images/other.tif", json)).toEqual([json[1]]);
    expect(matchMetadata("/images/unknown.tif", json)).toEqual([]);
});
test("ZIP import extracts supported nested images and associates JSON", () =>
    fixture(async directory => {
        const archive = path.join(directory, "collection.zip");

        await writeFile(
            archive,
            zipSync({
                "collection/image.tif": strToU8("TIFF bytes"),
                "collection/image.sidd": strToU8("SIDD bytes"),
                "collection/meta.json": strToU8('{"sensor":"Test SAR"}'),
                "ignore.txt": strToU8("ignore"),
                "__MACOSX/._image.tif": strToU8("ignore")
            })
        );

        const result = await prepareImport(
            [archive],
            path.join(directory, "imports"),
            new Set(["tif", "sidd"])
        );

        expect(result.errors).toEqual([]);
        expect(result.entries).toHaveLength(2);
        expect(await readFile(result.entries[0]!.filePath, "utf8")).toBe(
            "TIFF bytes"
        );
        expect(result.entries[0]!.metadata[0]?.data).toEqual({
            sensor: "Test SAR"
        });
        expect(result.entries[1]!.metadata[0]?.path).toBe(
            result.entries[0]!.metadata[0]?.path
        );
    }));
test("ZIP traversal fails without leaving extracted files", () =>
    fixture(async directory => {
        const archive = path.join(directory, "bad.zip");
        const imports = path.join(directory, "imports");

        for (const name of [
            "../escape.tif",
            "..\\escape.tif",
            "/absolute.tif",
            "C:/escape.tif"
        ]) {
            await writeFile(
                archive,
                zipSync({
                    [name]: strToU8("bad"),
                    "image.tif": strToU8("valid")
                })
            );
            await expect(
                extractImages(archive, imports, new Set(["tif"]))
            ).rejects.toThrow("Unsafe ZIP entry");
            expect(await readdir(imports)).toEqual([]);
        }
    }));
test("invalid metadata is reported without discarding the rest of the import", () =>
    fixture(async directory => {
        const image = path.join(directory, "image.tif");
        const json = path.join(directory, "metadata.json");

        await writeFile(image, "fixture");
        await writeFile(json, "bad JSON");

        const result = await prepareImport(
            [image, image, json],
            path.join(directory, "imports"),
            new Set(["tif"])
        );

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]!.metadata[0]?.error).toBeTruthy();
        expect(result.errors[0]).toContain("metadata.json");
        expect(
            (await readMetadata(path.join(directory, "missing.json"))).error
        ).toBeTruthy();
        await writeFile(json, '\uFEFF{"value":42}');
        expect((await readMetadata(json)).data).toEqual({ value: 42 });
        await writeFile(json, " ".repeat(5 * 1024 * 1024 + 1));
        expect((await readMetadata(json)).error).toContain("exceeds 5 MB");
    }));
