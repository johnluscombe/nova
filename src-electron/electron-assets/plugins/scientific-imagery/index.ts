import type { ImageCrop } from "../../../../src/types/crop.ts";
import type { SiddSettings } from "../../../../src/types/sidd.ts";
import { readFile, stat } from "node:fs/promises";
import type { FormationSettings } from "../../../../src/types/formation.ts";
import type {
    PolygonPoint,
    RegionStatistics
} from "../../../../src/types/region.ts";
import type { PixelData } from "../../../../src/types/pixel.ts";
import type { Scaling } from "../../../../src/types/scaling.ts";
import type {
    SliceData,
    SliceOrientation
} from "../../../../src/types/slice.ts";
import type { ImagePlugin } from "../../../image-plugins.ts";
import type {
    PluginParameters,
    ImagePluginResult
} from "../../../../src/types/image.ts";
import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const execute = promisify(execFile);

/**
 * Injectable shell-free Python process runner returning the worker JSON
 * response on stdout.
 */
type Runner = (
    python: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding
) => Promise<{ stdout: string }>;

/**
 * Execute the configured Python worker using a shell-free argument array.
 *
 * @param extraArgs - Worker operation arguments placed after the source
 * path.
 * @param timeout - Operation timeout in milliseconds; long processing
 * operations opt into a larger limit.
 * @returns Parsed worker JSON. Library logging remains on stderr.
 * @throws Error for interpreter, timeout, worker-exit, or JSON-protocol
 * failures.
 */
async function executeReader(
    filePath: string,
    parameters: PluginParameters = {},
    run: Runner = execute,
    extraArgs: string[] = [],
    timeout = 120_000
): Promise<unknown> {
    const configuredPython =
        parameters.python ??
        (process.platform === "win32" ? "python" : "python3");

    if (typeof configuredPython !== "string" || !configuredPython.trim()) {
        throw new Error(
            "Scientific Imagery's python parameter must be a nonempty Python executable path or command."
        );
    }

    const maxTiffPixels = parameters.maxTiffPixels;

    if (
        maxTiffPixels !== undefined &&
        (typeof maxTiffPixels !== "number" ||
            !Number.isSafeInteger(maxTiffPixels) ||
            maxTiffPixels < 0)
    ) {
        throw new Error(
            "Scientific Imagery's maxTiffPixels parameter must be a nonnegative safe integer (0 disables the limit)."
        );
    }

    const python =
        configuredPython.startsWith("~/") || configuredPython.startsWith("~\\")
            ? path.join(homedir(), configuredPython.slice(2))
            : configuredPython;
    let stdout;

    try {
        ({ stdout } = await run(
            python,
            [
                fileURLToPath(new URL("./reader.py", import.meta.url)),
                filePath,
                ...extraArgs,
                ...(maxTiffPixels !== undefined
                    ? ["--max-tiff-pixels", String(maxTiffPixels)]
                    : [])
            ],
            {
                encoding: "utf8",
                timeout,
                maxBuffer: 16 * 1024 * 1024,
                windowsHide: true,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: "utf-8",
                    PYTHONDONTWRITEBYTECODE: "1"
                }
            }
        ));
    } catch (cause) {
        const error = cause as NodeJS.ErrnoException & {
            killed?: boolean;

            stderr?: string;
        };

        if (error.code === "ENOENT") {
            throw new Error(
                `Scientific Imagery could not find Python interpreter ${JSON.stringify(python)}. Set parameters.python in plugin.json to an existing executable; see docs/scientific-imagery-plugin.md.`
            );
        }

        if (error.code === "EACCES") {
            throw new Error(
                `Scientific Imagery cannot execute Python interpreter ${JSON.stringify(python)}: permission denied.`
            );
        }

        if (error.killed) {
            throw new Error(
                timeout > 120_000
                    ? "Scientific image processing exceeded the ten-minute time limit."
                    : "Scientific Imagery preview exceeded the two-minute time limit."
            );
        }

        const details = String(error.stderr || error.message).trim();
        const diagnostic =
            details.match(
                /Scientific Imagery could not read the image: ([\s\S]*)$/
            )?.[1] ?? details;

        throw new Error(
            `Scientific Imagery reader failed: ${diagnostic.slice(-2000)}`
        );
    }

    let result;

    try {
        result = JSON.parse(stdout);
    } catch {
        throw new Error("Scientific Imagery reader returned invalid output.");
    }

    return result;
}

/**
 * Read and validate a scientific preview, then load any retained formation
 * diagnostic previews.
 */
export async function openScientificImage(
    filePath: string,
    parameters: PluginParameters = {},
    run: Runner = execute,
    scaling?: Scaling
): Promise<ImagePluginResult> {
    const result = (await executeReader(
        filePath,
        parameters,
        run,
        scaling ? ["--scaling", scaling] : []
    )) as ImagePluginResult;

    if (
        !result ||
        !Number.isSafeInteger(result.width) ||
        (result.width ?? 0) <= 0 ||
        !Number.isSafeInteger(result.height) ||
        (result.height ?? 0) <= 0 ||
        typeof result.previewDataUrl !== "string" ||
        !result.previewDataUrl.startsWith("data:image/png;base64,")
    ) {
        throw new Error(
            "Scientific Imagery reader returned an invalid preview."
        );
    }

    if (
        result.metadata?.["Image formation application"] ===
        "Nova CPU backprojection"
    ) {
        try {
            const sidecar = `${filePath}.formation.json`;

            if ((await stat(sidecar)).size > 4 * 1024 * 1024) {
                throw new Error("Formation previews exceed the size limit.");
            }

            const data = JSON.parse(await readFile(sidecar, "utf8"));

            if (data.version !== 1) {
                throw new Error("Unsupported formation preview version.");
            }

            if (!Array.isArray(data.products) || data.products.length > 12) {
                throw new Error("Invalid formation products.");
            }

            result.formationProducts = data.products;
        } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
                result.metadata["Formation previews"] =
                    "Unavailable: the diagnostic preview file could not be read.";
            }
        }
    }

    return result;
}

/**
 * Read source row or column samples in the requested scaling; positions
 * remain zero-based pixel indices.
 */
export async function readImageSlice(
    filePath: string,
    orientation: SliceOrientation,
    index: number,
    parameters: PluginParameters = {},
    run: Runner = execute,
    scaling?: Scaling
): Promise<SliceData> {
    return (await executeReader(filePath, parameters, run, [
        "--slice",
        orientation,
        String(index),
        ...(scaling ? [scaling] : [])
    ])) as SliceData;
}

/**
 * Read one original source pixel, using the image preview peak as the
 * relative-power reference.
 */
export async function readImagePixel(
    filePath: string,
    row: number,
    column: number,
    parameters: PluginParameters = {},
    run: Runner = execute,
    scaling: Scaling = "amplitude",
    peakPower = 0
): Promise<PixelData> {
    return (await executeReader(filePath, parameters, run, [
        "--pixel",
        String(row),
        String(column),
        scaling,
        String(peakPower)
    ])) as PixelData;
}

/**
 * Compute bounded source-polygon percentiles in the requested scaling and
 * peak reference.
 */
export async function readImageRegion(
    filePath: string,
    polygon: PolygonPoint[],
    parameters: PluginParameters = {},
    run: Runner = execute,
    scaling: Scaling = "amplitude",
    peakPower = 0
): Promise<RegionStatistics> {
    return (await executeReader(filePath, parameters, run, [
        "--region",
        JSON.stringify(polygon),
        scaling,
        String(peakPower)
    ])) as RegionStatistics;
}

/**
 * Ask the Python worker to form a new SICD with the supplied
 * backprojection settings.
 */
export async function formSicd(
    filePath: string,
    outputPath: string,
    settings: FormationSettings,
    parameters: PluginParameters = {},
    run: Runner = execute
): Promise<void> {
    await executeReader(
        filePath,
        parameters,
        run,
        ["--form-sicd", outputPath, JSON.stringify(settings)],
        600_000
    );
}

/**
 * Ask the Python worker to create a detected SIDD using the supplied
 * display and projection settings.
 */
export async function createSidd(
    filePath: string,
    outputPath: string,
    settings: SiddSettings,
    parameters: PluginParameters = {},
    run: Runner = execute
): Promise<void> {
    await executeReader(
        filePath,
        parameters,
        run,
        ["--create-sidd", outputPath, JSON.stringify(settings)],
        600_000
    );
}

/**
 * Crop original scientific source pixels into a new file and return its
 * generated path.
 */
export async function cropImage(
    filePath: string,
    directory: string,
    selection: ImageCrop,
    parameters: PluginParameters = {},
    run: Runner = execute
): Promise<string> {
    const result = (await executeReader(
        filePath,
        parameters,
        run,
        ["--crop", directory, JSON.stringify(selection)],
        600_000
    )) as { path: string };

    return result.path;
}

export default {
    exportImage: async (filePath, outputPath, parameters, scaling) => {
        await executeReader(
            filePath,
            parameters,
            execute,
            ["--export", outputPath, scaling ?? "amplitude"],
            600_000
        );
    },
    crop: (filePath, directory, selection, parameters) =>
        cropImage(filePath, directory, selection, parameters),
    createSidd: (filePath, outputPath, settings, parameters) =>
        createSidd(filePath, outputPath, settings, parameters),
    formSicd: (filePath, outputPath, settings, parameters) =>
        formSicd(filePath, outputPath, settings, parameters),
    readRegion: (filePath, polygon, parameters, scaling, peakPower) =>
        readImageRegion(
            filePath,
            polygon,
            parameters,
            execute,
            scaling,
            peakPower
        ),
    readPixel: (filePath, row, column, parameters, scaling, peakPower) =>
        readImagePixel(
            filePath,
            row,
            column,
            parameters,
            execute,
            scaling,
            peakPower
        ),
    readSlice: (filePath, orientation, index, parameters, scaling) =>
        readImageSlice(
            filePath,
            orientation,
            index,
            parameters,
            execute,
            scaling
        ),
    open: (filePath, parameters, scaling?: Scaling) =>
        openScientificImage(filePath, parameters, execute, scaling)
} satisfies ImagePlugin;
