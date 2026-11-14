import { defineConfig } from "@playwright/test";

export default defineConfig({
    reporter:
        process.env.NOVA_COVERAGE === "1"
            ? [["list"], ["./tests/e2e/coverage-reporter.ts"]]
            : "list",
    projects: [
        {
            name: "e2e",
            testDir: "./tests/e2e",
            testMatch: "**/*.spec.ts",
            use: { trace: "retain-on-failure" }
        }
    ],
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000
});
