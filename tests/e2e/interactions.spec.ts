import { collectCoverage } from "./coverage";
import { test, expect } from "./fixtures";
import { createScenario, chooseFile } from "./helpers";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";

const ribbon = {
    tabs: [
        {
            id: "home",
            label: "Home",
            groups: [
                {
                    id: "file",
                    label: "File",
                    buttons: [
                        {
                            id: "inspect",
                            label: "Inspect",
                            requiresScenario: true
                        }
                    ]
                },
                {
                    id: "image",
                    label: "Image",
                    buttons: [{ id: "fail", label: "Fail action" }]
                },
                {
                    id: "utilities",
                    label: "Utilities",
                    buttons: [{ id: "ping", label: "Ping" }]
                }
            ]
        },
        {
            id: "tools",
            label: "Tools",
            groups: [
                {
                    id: "tools",
                    label: "Tools",
                    buttons: [{ id: "report", label: "Report" }]
                }
            ]
        }
    ]
};
test.use({
    pluginFiles: {
        "test/plugin.json": JSON.stringify({
            apiVersion: 1,
            id: "test.decoder",
            name: "Test decoder",
            main: "index.ts",
            extensions: ["test"],
            ribbon
        }),
        "test/index.ts": `import { access } from 'node:fs/promises';
        export default {
            async open(file: string) {
                if (file.includes('slow')) {
                    for (let i = 0; i < 500; i++) {
                        try { await access(file + '.ready'); break; } catch {}
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                }
                await access(file);
                if (file.includes('broken')) throw new Error('Intentional decoder failure');
                return { width: 40, height: 20, metadata: { Collector: 'Test radar' }, statistics: { '25th percentile': 1.25, '50th percentile': 2.5, '90th percentile': 9, '99th percentile': 9.9 }, previewDataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>').toString('base64') };
            },
            executeRibbonAction(id: string, context: { scenarioPath: string | null }) {
                if (id === 'fail') throw new Error('Intentional action failure');
                return { message: id === 'inspect' ? 'Inspected ' + context.scenarioPath : 'Action ' + id };
            }
        };`
    }
});

test("widget loading, statistics, keyboard movement, dragging, resizing and window controls", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    const file = path.join(profile, "slow.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    const widget = page.getByRole("article", {
        name: "slow.test",
        exact: true
    });
    await expect(
        widget.getByText("Loading image…", { exact: true })
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Statistics", exact: true })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Metadata", exact: true }).click();
    await expect(widget.getByText("Loading metadata…")).toBeVisible();
    await writeFile(file + ".ready", "ready");
    await expect(widget.getByRole("img")).toBeVisible();
    await expect(widget.getByText("Test radar")).toBeVisible();
    await page.getByRole("button", { name: "Statistics", exact: true }).click();
    await expect(
        widget.getByRole("region", { name: "Image statistics" })
    ).toContainText("2.5");
    await widget.getByRole("button", { name: "Close statistics" }).click();
    await widget.getByRole("button", { name: "Close metadata" }).click();
    const title = widget.getByLabel(
        "slow.test window title. Use arrow keys to move."
    );
    const before = await widget.boundingBox();
    await title.press("ArrowRight");
    await title.press("Shift+ArrowDown");
    await expect
        .poll(async () => (await widget.boundingBox())!.x)
        .toBeGreaterThan(before!.x);
    await title.press("a");
    const resize = widget.getByLabel("Resize slow.test with arrow keys");
    const width = (await widget.boundingBox())!.width;
    await resize.press("ArrowRight");
    await expect
        .poll(async () => (await widget.boundingBox())!.width)
        .toBeGreaterThan(width);
    await resize.press("a");
    const position = await title.boundingBox();
    await page.mouse.move(position!.x + 80, position!.y + 12);
    await page.mouse.down();
    await page.mouse.move(position!.x + 110, position!.y + 32, { steps: 4 });
    await page.mouse.up();
    const handle = widget.locator(".resize-se").first();
    const corner = await handle.boundingBox();
    await page.mouse.move(corner!.x + 2, corner!.y + 2);
    await page.mouse.down();
    await page.mouse.move(corner!.x + 20, corner!.y + 12, { steps: 3 });
    await page.mouse.up();
    await widget.getByRole("button", { name: "Maximize slow.test" }).click();
    await expect(
        widget.getByRole("button", { name: "Restore slow.test" })
    ).toBeVisible();
    await title.press("ArrowLeft");
    await widget.getByRole("button", { name: "Restore slow.test" }).click();
    await widget.getByRole("button", { name: "Minimize slow.test" }).click();
    await expect(widget).toBeHidden();
    await page.getByRole("button", { name: "slow.test", exact: true }).click();
    await expect(widget).toBeVisible();
    await widget.getByRole("button", { name: "Close slow.test" }).click();
    await expect(widget).toHaveCount(0);
});

test("reopens saved widgets, preserves geometry and reports missing image references", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const file = path.join(profile, "saved.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    const widget = page.getByRole("article", {
        name: "saved.test",
        exact: true
    });
    await expect(widget.getByRole("img")).toBeVisible();
    await widget
        .getByLabel("saved.test window title. Use arrow keys to move.")
        .press("Shift+ArrowRight");
    const bounds = await widget.boundingBox();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(widget).toHaveCount(0);
    await chooseFile(application, scenario);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(widget.getByRole("img")).toBeVisible();
    expect((await widget.boundingBox())!.x).toBe(bounds!.x);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await rm(file);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(widget).toContainText("ENOENT");
    await expect(widget.getByRole("img")).toHaveCount(0);
});

test("plugin ribbon contributions run declared actions and surface failures", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await expect(
        page.getByRole("button", { name: "Inspect", exact: true })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Ping", exact: true }).click();
    await expect(page.getByText("Action ping", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await createScenario(application, page, profile);
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    await expect(
        page.getByText(`Inspected ${path.join(profile, "test.scenario")}`, {
            exact: true
        })
    ).toBeVisible();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await page
        .getByRole("button", { name: "Fail action", exact: true })
        .click();
    await expect(page.getByRole("alert")).toContainText(
        "Intentional action failure"
    );
    await page.getByRole("tab", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await expect(
        page.getByText("Action report", { exact: true })
    ).toBeVisible();
});

test("cancellation and invalid scenarios preserve the current document; decoder failures remain visible", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    await application.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({
            canceled: true,
            filePath: ""
        });
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    const invalid = path.join(profile, "invalid.scenario");
    await writeFile(invalid, "not sqlite");
    await chooseFile(application, invalid);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Open image", exact: true })
    ).toBeEnabled();
    const broken = path.join(profile, "slow-broken.test");
    await writeFile(broken, "bad");
    await chooseFile(application, broken);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    await expect(
        page.getByText("Loading image…", { exact: true })
    ).toBeVisible();
    await writeFile(broken + ".ready", "ready");
    await expect(
        page.getByRole("article", { name: "slow-broken.test", exact: true })
    ).toContainText("Intentional decoder failure");
});

test("closing a loading widget does not recreate it when decoding completes", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    const file = path.join(profile, "slow-close.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    const widget = page.getByRole("article", {
        name: "slow-close.test",
        exact: true
    });
    await expect(
        widget.getByText("Loading image…", { exact: true })
    ).toBeVisible();
    await widget.getByRole("button", { name: "Close slow-close.test" }).click();
    await writeFile(file + ".ready", "ready");
    await expect(
        page.getByRole("button", { name: "Open image", exact: true })
    ).toBeEnabled();
    await expect(widget).toHaveCount(0);
});

test("restores the last session on renderer startup", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    const file = path.join(profile, "startup.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    await expect(
        page
            .getByRole("article", { name: "startup.test", exact: true })
            .getByRole("img")
    ).toBeVisible();
    // Drain queued autosaves and preserve coverage before the renderer is replaced.
    await page.evaluate(() => window.scenario.restoreLast());
    await collectCoverage(application);
    await page.reload();
    await expect(
        page
            .getByRole("article", { name: "startup.test", exact: true })
            .getByRole("img")
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Statistics", exact: true })
    ).toBeEnabled();
});

test("reports scenario creation and close failures without discarding the document", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    await application.evaluate(
        ({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        },
        path.join(profile, "missing", "invalid.scenario")
    );
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Open image", exact: true })
    ).toBeEnabled();
    await application.evaluate(({ BrowserWindow }) => {
        const ipc = BrowserWindow.getAllWindows()[0]!.webContents.ipc;
        ipc.removeHandler("scenario:close");
        ipc.handle("scenario:close", () => {
            throw new Error("Close failed");
        });
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Close failed");
    await expect(
        page.getByRole("button", { name: "Open image", exact: true })
    ).toBeEnabled();
});

test("surfaces autosave errors and prevents switching away from unsaved work", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    await application.evaluate(({ BrowserWindow }) => {
        const ipc = BrowserWindow.getAllWindows()[0]!.webContents.ipc;
        ipc.removeHandler("scenario:workspace");
        ipc.handle("scenario:workspace", () => {
            throw new Error("Disk full");
        });
    });
    const file = path.join(profile, "unsaved.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Disk full");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
        page.getByRole("article", { name: "unsaved.test", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Disk full");
    // Restore the IPC contract so fixture shutdown can flush successfully.
    await application.evaluate(({ BrowserWindow }) => {
        const ipc = BrowserWindow.getAllWindows()[0]!.webContents.ipc;
        ipc.removeHandler("scenario:workspace");
        ipc.handle("scenario:workspace", () => undefined);
    });
});

test("percentile settings validate, update open images, and persist after reload", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const field = dialog.getByRole("combobox", {
        name: "Percentiles",
        exact: true
    });
    // Removing every chip should keep the dialog open with validation feedback.
    for (let index = 0; index < 7; index++) {
        await dialog
            .getByRole("button", { name: "Remove", exact: true })
            .first()
            .click();
    }
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
        dialog.getByText("Select at least one percentile from 0 to 100.")
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await createScenario(application, page, profile);
    const file = path.join(profile, "percentiles.test");
    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    const widget = page.getByRole("article", {
        name: "percentiles.test",
        exact: true
    });
    await expect(widget.getByRole("img")).toBeVisible();
    await page.getByRole("button", { name: "Statistics", exact: true }).click();
    await expect(
        widget.getByText("50th percentile", { exact: true })
    ).toBeVisible();
    await expect(
        widget.getByText("90th percentile", { exact: true })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const value of [1, 5, 50, 75, 95, 99]) {
        await dialog
            .locator(".q-chip")
            .filter({ has: page.getByText(String(value), { exact: true }) })
            .getByRole("button", { name: "Remove", exact: true })
            .click();
    }
    await field.click();
    await field.fill("90");
    await page.getByRole("option", { name: "90", exact: true }).click();
    await field.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
        widget.getByText("90th percentile", { exact: true })
    ).toBeVisible();
    await expect(
        widget.getByText("50th percentile", { exact: true })
    ).toHaveCount(0);
    await collectCoverage(application);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(dialog.locator(".q-chip")).toHaveCount(2);
    await expect(dialog.locator(".q-chip")).toContainText(["25", "90"]);
    await dialog
        .getByRole("button", { name: "Restore defaults", exact: true })
        .click();
    await expect(dialog.locator(".q-chip")).toHaveCount(7);
    await expect(dialog.locator(".q-chip")).toContainText([
        "1",
        "5",
        "25",
        "50",
        "75",
        "95",
        "99"
    ]);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
});
