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
type Runner = (
    python: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding
) => Promise<{ stdout: string }>;
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
                    ? "Image formation exceeded the ten-minute time limit. Try a smaller output or aperture."
                    : "Scientific Imagery preview exceeded the two-minute time limit."
            );
        }
        throw new Error(
            `Scientific Imagery reader failed: ${String(
                error.stderr || error.message
            )
                .trim()
                .slice(-2000)}`
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
export default {
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
