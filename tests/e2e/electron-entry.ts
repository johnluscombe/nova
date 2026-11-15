// Test-only entry: isolate preferences before the production main module starts.
import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const profile = process.env.NOVA_TEST_PROFILE;

if (!profile) {
    throw new Error(
        "NOVA_TEST_PROFILE is required for the Electron test entry."
    );
}

// Electron exposes this startup helper at runtime but omits it from its declarations.
(app as typeof app & { setAppPath(path: string): void }).setAppPath(
    process.cwd()
);
app.setPath("userData", profile);
void import(pathToFileURL(path.resolve("electron-main.js")).href);
