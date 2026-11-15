import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import type { MetadataAttachment } from "../src/types/metadata";

const maxJsonBytes = 5 * 1024 * 1024;
const maxArchiveBytes = 50 * 1024 ** 3;

/**
 * Read a size-limited JSON attachment, retaining parse failures as
 * attachment errors.
 */
export async function readMetadata(
    filePath: string
): Promise<MetadataAttachment> {
    const result: MetadataAttachment = {
        path: filePath,
        name: path.basename(filePath)
    };

    try {
        if (path.extname(filePath).toLowerCase() !== ".json") {
            throw new Error("Metadata must be a JSON file.");
        }

        if ((await stat(filePath)).size > maxJsonBytes) {
            throw new Error("JSON metadata exceeds 5 MB.");
        }

        result.data = JSON.parse(
            (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")
        );
    } catch (cause) {
        result.error = cause instanceof Error ? cause.message : String(cause);
    }

    return result;
}

/**
 * Normalize a vendor filename for matching image products to metadata
 * sidecars.
 */
function stem(file: string) {
    return path
        .basename(file)
        .toLowerCase()
        .replace(/\.[^.]+$/, "")
        .replace(
            /(?:[._-](?:cphd|sicd|sidd|tiff?|nitf|ntf|metadata|meta|catalog|extended|stac|gec|grd))+$/g,
            ""
        );
}

/**
 * Search nested metadata for a reference to the image basename without
 * recursive traversal.
 */
function referencesImage(data: unknown, basename: string): boolean {
    // Iterative traversal also handles deeply nested vendor metadata safely.
    const pending = [data];

    while (pending.length) {
        const value = pending.pop();

        if (typeof value === "string") {
            const name = value
                .split(/[?#]/)[0]!
                .replaceAll("\\", "/")
                .split("/")
                .at(-1)
                ?.toLowerCase();

            if (name === basename.toLowerCase()) {
                return true;
            }
        } else if (value && typeof value === "object") {
            for (const child of Object.values(value)) {
                pending.push(child);
            }
        }
    }

    return false;
}

/**
 * Associate sidecars by filename, explicit image references, or an
 * unambiguous sibling.
 */
export function matchMetadata(
    image: string,
    attachments: MetadataAttachment[]
): MetadataAttachment[] {
    if (attachments.length === 1) {
        return attachments;
    }

    const matched = attachments.filter(
        item =>
            stem(item.path) === stem(image) ||
            referencesImage(item.data, path.basename(image))
    );

    if (matched.length) {
        return matched;
    }

    const siblings = attachments.filter(
        item => path.dirname(item.path) === path.dirname(image)
    );

    return siblings.length === 1 ? siblings : [];
}

/**
 * Validate a ZIP member path before resolving it inside the import
 * directory.
 */
function safeEntry(name: string): string {
    const normalized = name.replaceAll("\\", "/");

    if (
        normalized.startsWith("/") ||
        normalized.includes(":") ||
        normalized.includes("\0") ||
        normalized.split("/").some(part => part === "..")
    ) {
        throw new Error(`Unsafe ZIP entry: ${name}`);
    }

    return normalized;
}

/**
 * Stream supported images and JSON sidecars into a durable import folder,
 * enforcing archive limits.
 */
export async function extractImages(
    archive: string,
    importsDirectory: string,
    extensions: Set<string>
): Promise<string[]> {
    const destination = path.join(importsDirectory, randomUUID());

    await mkdir(destination, { recursive: true });

    const files: string[] = [];
    let total = 0;
    let entries = 0;
    let failure: unknown;
    let writes = Promise.resolve();
    const handles = new Set<Awaited<ReturnType<typeof open>>>();
    const unzip = new Unzip(file => {
        try {
            if (++entries > 10000) {
                throw new Error("ZIP contains more than 10,000 entries.");
            }

            const name = safeEntry(file.name);

            if (
                name.endsWith("/") ||
                name.startsWith("__MACOSX/") ||
                path.basename(name).startsWith("._")
            ) {
                return;
            }

            const extension = path.extname(name).slice(1).toLowerCase();

            if (extension !== "json" && !extensions.has(extension)) {
                return;
            }

            if (
                file.originalSize &&
                file.originalSize + total > maxArchiveBytes
            ) {
                throw new Error("ZIP contents exceed 50 GB.");
            }

            const output = path.join(destination, name);

            files.push(output);

            // One promise chain provides ordered writes, propagates disk errors,
            // and lets the input stream apply backpressure after each chunk.
            let handle: Awaited<ReturnType<typeof open>> | undefined;

            /**
             * Lazily open an archive output file after creating its parent
             * directories.
             */
            const ready = async () => {
                if (!handle) {
                    await mkdir(path.dirname(output), { recursive: true });
                    handle = await open(output, "wx");
                    handles.add(handle);
                }

                return handle;
            };

            file.ondata = (error, chunk, final) => {
                if (error) {
                    failure = error;

                    return;
                }

                total += chunk.length;

                if (total > maxArchiveBytes) {
                    failure = new Error("ZIP contents exceed 50 GB.");

                    return;
                }

                const data = Buffer.from(chunk);

                writes = writes.then(async () => {
                    const target = await ready();

                    try {
                        if (data.length) {
                            await target.writeFile(data);
                        }
                    } finally {
                        if (final) {
                            await target.close();
                            handles.delete(target);
                        }
                    }
                });
            };
            file.start();
        } catch (cause) {
            failure = cause;
        }
    });

    unzip.register(UnzipInflate);

    try {
        for await (const chunk of createReadStream(archive, {
            highWaterMark: 64 * 1024
        })) {
            unzip.push(new Uint8Array(chunk as Buffer), false);
            await writes;

            if (failure) {
                throw failure;
            }
        }

        unzip.push(new Uint8Array(), true);
        await writes;

        if (failure) {
            throw failure;
        }

        if (!files.length) {
            await rm(destination, { recursive: true, force: true });
        }

        return files;
    } catch (cause) {
        await writes.catch(() => undefined);
        await Promise.allSettled([...handles].map(handle => handle.close()));
        await rm(destination, { recursive: true, force: true });

        throw cause;
    }
}

/**
 * Expand selected files and ZIP archives into images with their matching
 * metadata attachments.
 */
export async function prepareImport(
    paths: string[],
    importsDirectory: string,
    extensions: Set<string>
) {
    const files: string[] = [];
    const errors: string[] = [];

    for (const file of paths) {
        try {
            if (path.extname(file).toLowerCase() === ".zip") {
                files.push(
                    ...(await extractImages(file, importsDirectory, extensions))
                );
            } else {
                files.push(file);
            }
        } catch (cause) {
            errors.push(
                `${path.basename(file)}: ${cause instanceof Error ? cause.message : String(cause)}`
            );
        }
    }

    const unique = [...new Set(files.map(file => path.resolve(file)))];

    if (
        unique.filter(file => path.extname(file).toLowerCase() === ".json")
            .length > 32
    ) {
        throw new Error("Import at most 32 JSON metadata files at a time.");
    }

    const attachments = await Promise.all(
        unique
            .filter(file => path.extname(file).toLowerCase() === ".json")
            .map(readMetadata)
    );
    const images = unique.filter(file =>
        extensions.has(path.extname(file).slice(1).toLowerCase())
    );
    const matched = new Set<string>();
    const entries = images.map(filePath => {
        const metadata = matchMetadata(filePath, attachments);

        metadata.forEach(item => matched.add(item.path));

        return { filePath, metadata };
    });

    for (const attachment of attachments) {
        if (attachment.error) {
            errors.push(`${attachment.name}: ${attachment.error}`);
        } else if (!matched.has(attachment.path)) {
            errors.push(
                `No image match for ${attachment.name}. Use Attach Metadata to associate it manually.`
            );
        }
    }

    if (!images.length) {
        errors.push(
            "No supported images found. Use Attach Metadata to add JSON to an existing image."
        );
    }

    return { entries, errors };
}
