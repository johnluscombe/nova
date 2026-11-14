import type { Reporter } from "@playwright/test/reporter";
import coverageLibrary, { type CoverageMapData } from "istanbul-lib-coverage";
import sourceMaps from "istanbul-lib-source-maps";
import reportLibrary from "istanbul-lib-report";
import reports from "istanbul-reports";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export interface CoverageReporterOptions {
    rawInputFile?: string;
}

export default class CoverageReporter implements Reporter {
    private readonly directory = path.resolve("coverage/playwright");
    private readonly rawInputFile: string | undefined;
    constructor(options: CoverageReporterOptions = {}) {
        this.rawInputFile =
            options.rawInputFile === undefined
                ? undefined
                : path.resolve(options.rawInputFile);
    }
    onBegin() {
        if (!this.rawInputFile) {
            rmSync(this.directory, { recursive: true, force: true });
            mkdirSync(path.join(this.directory, "raw"), { recursive: true });
        }
    }

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
