import { test, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import reports from "istanbul-reports";
import CoverageReporter from "../e2e/coverage-reporter.ts";

test("reads a custom raw input file and preserves it at startup", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-coverage-input-"));
    const execute = vi.fn();
    const create = vi.spyOn(reports, "create").mockReturnValue({ execute });
    try {
        const input = path.join(directory, "input.json");
        const source = path.join(directory, "source.ts");
        writeFileSync(
            input,
            JSON.stringify({
                [source]: {
                    path: source,
                    statementMap: {
                        0: {
                            start: { line: 1, column: 0 },
                            end: { line: 1, column: 10 }
                        }
                    },
                    fnMap: {},
                    branchMap: {},
                    s: { 0: 1 },
                    f: {},
                    b: {}
                }
            })
        );
        const reporter = new CoverageReporter({
            rawInputFile: path.relative(process.cwd(), input)
        });
        reporter.onBegin();
        expect(JSON.parse(readFileSync(input, "utf8"))).toHaveProperty(source);
        await reporter.onEnd();
        expect(execute).toHaveBeenCalledTimes(4);
        expect(create).toHaveBeenCalledWith("json", {
            file: "coverage-playwright.json"
        });
        expect(
            execute.mock.calls[0][0]
                .getTree("pkg")
                .getRoot()
                .getCoverageSummary().lines.pct
        ).toBe(100);
    } finally {
        create.mockRestore();
        rmSync(directory, { recursive: true, force: true });
    }
});
