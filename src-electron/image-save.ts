import { constants } from "node:fs";
import { copyFile, open, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const nitfExtensions = new Set([".sidd", ".sicd", ".nitf", ".ntf"]);
export const rasterExportExtensions = [
    "png",
    "jpg",
    "jpeg",
    "tif",
    "tiff",
    "bmp",
    "webp"
];

/** Confirm the actual container before allowing alternate NITF filename suffixes. */
async function isNitf(source: string): Promise<boolean> {
    const file = await open(source, "r");

    try {
        const header = Buffer.alloc(9);
        const { bytesRead } = await file.read(header, 0, header.length, 0);

        return (
            bytesRead === header.length &&
            header.toString("ascii") === "NITF02.10"
        );
    } finally {
        await file.close();
    }
}

/** Save native files or atomically replace a raster export without modifying source data. */
export class ImageSaver {
    /**
     * Ask for a destination on every save. Cancellation leaves existing files
     * unchanged; successful saves retain source data or encode a raster copy.
     */
    async save(
        source: string,
        choose: (suggestedPath: string) => Promise<string | null>,
        convert?: (source: string, output: string) => Promise<void>
    ): Promise<string | null> {
        if (typeof source !== "string" || !path.isAbsolute(source)) {
            throw new Error("Choose an image with a valid source file.");
        }

        const sourcePath = path.resolve(source);
        const info = await stat(sourcePath);

        if (!info.isFile()) {
            throw new Error("The image source is not a file.");
        }

        const destination = await choose(sourcePath);

        if (!destination) {
            return null;
        }

        const target = path.resolve(destination);
        const extension = path.extname(sourcePath).toLowerCase();
        const targetExtension = path.extname(target).toLowerCase();
        const sameEncoding = [
            [".jpg", ".jpeg"],
            [".tif", ".tiff"]
        ].some(
            extensions =>
                extensions.includes(extension) &&
                extensions.includes(targetExtension)
        );
        let conversion = false;

        if (targetExtension !== extension && !sameEncoding) {
            if (
                nitfExtensions.has(extension) &&
                [".nitf", ".ntf"].includes(targetExtension)
            ) {
                if (!(await isNitf(sourcePath))) {
                    throw new Error(
                        "This source is not a NITF 2.1 container. Conversion from its source format to NITF is not supported."
                    );
                }
            } else if (
                rasterExportExtensions.includes(targetExtension.slice(1)) &&
                convert
            ) {
                conversion = true;
            } else {
                throw new Error(
                    `Save this image with its original ${extension || "file"} extension. Format conversion is not supported.`
                );
            }
        }

        if (target !== sourcePath) {
            const temporary = path.join(
                path.dirname(target),
                `.nova-save-${randomUUID()}${targetExtension}`
            );

            try {
                if (conversion) {
                    await convert!(sourcePath, temporary);
                } else {
                    await copyFile(
                        sourcePath,
                        temporary,
                        constants.COPYFILE_EXCL
                    );
                }
                await rename(temporary, target);
            } finally {
                await rm(temporary, { force: true });
            }
        }

        return target;
    }
}
