import type { ElectronApplication } from "@playwright/test";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Collect renderer Istanbul counters from live application windows when
 * coverage is enabled.
 */
export async function collectCoverage(application: ElectronApplication) {
    if (process.env.NOVA_COVERAGE !== "1") {
        return;
    }

    const directory = path.resolve("coverage/playwright/raw");

    await mkdir(directory, { recursive: true });

    for (const page of application.windows()) {
        if (page.isClosed()) {
            continue;
        }

        const coverage = await page.evaluate(
            () =>
                (window as Window & { __coverage__?: CoverageMapData })
                    .__coverage__
        );

        if (coverage) {
            await writeFile(
                path.join(directory, `${randomUUID()}.json`),
                JSON.stringify(coverage)
            );
        }
    }
}
