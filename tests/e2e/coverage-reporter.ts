import type { Reporter } from "@playwright/test/reporter";
import coverageLibrary, { type CoverageMapData } from "istanbul-lib-coverage";
import sourceMaps from "istanbul-lib-source-maps";
import reportLibrary from "istanbul-lib-report";
import reports from "istanbul-reports";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Configuration for generating Playwright Istanbul reports from collected raw
 * counters.
 */
export interface CoverageReporterOptions {
    /**
     * Optional raw Istanbul JSON input path, resolved from the working
     * directory; otherwise consume per-test files.
     */
    rawInputFile?: string;
}

/**
 * Merge renderer counters and remap them to source coordinates for Istanbul
 * reports.
 */
export default class CoverageReporter implements Reporter {
    private readonly directory = path.resolve("coverage/playwright");
    private readonly rawInputFile: string | undefined;

    /**
     * Resolve an optional raw coverage input path for externally collected
     * counters.
     */
    constructor(options: CoverageReporterOptions = {}) {
        this.rawInputFile =
            options.rawInputFile === undefined
                ? undefined
                : path.resolve(options.rawInputFile);
    }

    /**
     * Prepare the raw output folder unless the reporter is consuming an
     * existing coverage file.
     */
    onBegin() {
        if (!this.rawInputFile) {
            rmSync(this.directory, { recursive: true, force: true });
            mkdirSync(path.join(this.directory, "raw"), { recursive: true });
        }
    }

    /**
     * Merge and source-map raw Istanbul counters, then write the
     * Playwright coverage reports.
     */
    async onEnd() {
        const map = coverageLibrary.createCoverageMap({});
        const files = this.rawInputFile
            ? [this.rawInputFile]
            : readdirSync(path.join(this.directory, "raw"))
                  .filter(file => file.endsWith(".json"))
                  .map(file => path.join(this.directory, "raw", file));

        for (const file of files) {
            map.merge(
                JSON.parse(readFileSync(file, "utf8")) as CoverageMapData
            );
        }

        if (!map.files().length) {
            console.error(
                "No Istanbul coverage collected. Run npm run test:e2e:coverage to build an instrumented app."
            );

            return { status: "failed" as const };
        }

        const remapped = await sourceMaps
            .createSourceMapStore()
            .transformCoverage(map);
        const context = reportLibrary.createContext({
            dir: this.directory,
            coverageMap: remapped
        });

        for (const reporter of ["text", "html", "lcovonly", "json"] as const) {
            reports
                .create(
                    reporter,
                    reporter === "json"
                        ? { file: "coverage-playwright.json" }
                        : {}
                )
                .execute(context);
        }
    }
}
