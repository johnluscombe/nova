import {
    test as base,
    expect,
    _electron as electron,
    type ElectronApplication
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectCoverage } from "./coverage";

const requireElectron = createRequire(
    path.resolve("src-electron/package.json")
);

type ElectronFixtures = {
    pluginFiles: Record<string, string>;
    profile: string;
    application: ElectronApplication;
};

export const test = base.extend<ElectronFixtures>({
    pluginFiles: [{}, { option: true }],
    profile: async ({ pluginFiles }, use) => {
        const profile = await mkdtemp(path.join(tmpdir(), "nova-e2e-"));
        try {
            for (const [name, content] of Object.entries(pluginFiles)) {
                const file = path.join(profile, "plugins", name);
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, content);
            }
            await use(profile);
        } finally {
            await rm(profile, { recursive: true, force: true });
        }
    },
    application: [
        async ({ profile }, use) => {
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                NOVA_TEST_PROFILE: profile
            };
            delete env.ELECTRON_RUN_AS_NODE;
            const application = await electron.launch({
                executablePath: requireElectron("electron") as string,
                args: [path.resolve("tests/e2e/electron-entry.cjs")],
                cwd: path.resolve("dist/electron/UnPackaged"),
                env: Object.fromEntries(
                    Object.entries(env).filter(
                        (entry): entry is [string, string] =>
                            entry[1] !== undefined
                    )
                )
            });
            try {
                await use(application);
            } finally {
                try {
                    await collectCoverage(application);
                } finally {
                    await application.close();
                }
            }
        },
        { auto: true }
    ]
});

export { expect };
