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
    extraArgs: string[] = []
): Promise<unknown> {
    const configuredPython =
        parameters.python ??
        (process.platform === "win32" ? "python" : "python3");
    if (typeof configuredPython !== "string" || !configuredPython.trim()) {
        throw new Error(
            "SICD's python parameter must be a nonempty Python executable path or command."
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
                ...extraArgs
            ],
            {
                encoding: "utf8",
                timeout: 120_000,
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
                `SICD could not find Python interpreter ${JSON.stringify(python)}. Set parameters.python in plugin.json to an existing executable; see docs/sicd-plugin.md.`
            );
        }
        if (error.code === "EACCES") {
            throw new Error(
                `SICD cannot execute Python interpreter ${JSON.stringify(python)}: permission denied.`
            );
        }
        if (error.killed) {
            throw new Error("SICD preview exceeded the two-minute time limit.");
        }
        throw new Error(
            `SICD reader failed: ${String(error.stderr || error.message)
                .trim()
                .slice(-2000)}`
        );
    }
    let result;
    try {
        result = JSON.parse(stdout);
    } catch {
        throw new Error("SICD reader returned invalid output.");
    }
    return result;
}
export async function openSicd(
    filePath: string,
    parameters: PluginParameters = {},
    run: Runner = execute
): Promise<ImagePluginResult> {
    const result = (await executeReader(
        filePath,
        parameters,
        run
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
        throw new Error("SICD reader returned an invalid preview.");
    }
    return result;
}
export async function readSicdSlice(
    filePath: string,
    orientation: SliceOrientation,
    index: number,
    parameters: PluginParameters = {},
    run: Runner = execute
): Promise<SliceData> {
    return (await executeReader(filePath, parameters, run, [
        "--slice",
        orientation,
        String(index)
    ])) as SliceData;
}
export default {
    readSlice: (filePath, orientation, index, parameters) =>
        readSicdSlice(filePath, orientation, index, parameters),
    open: (filePath, parameters) => openSicd(filePath, parameters)
} satisfies ImagePlugin;
