import { clickRibbon, selectRibbonFor } from "./helpers";
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
            readSlice(file: string, orientation: string, index: number) {
                return { points: [{ position: 0, value: index }, { position: orientation === 'horizontal' ? 39 : 19, value: index + 1 }], positionLabel: orientation === 'horizontal' ? 'Column (pixel)' : 'Row (pixel)', valueLabel: 'Source amplitude' };
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
    await clickRibbon(page, "Add Image");

    const widget = page.getByRole("article", {
        name: "slow.test",
        exact: true
    });

    await expect(
        widget.getByText("Loading image…", { exact: true })
    ).toBeVisible();
    await selectRibbonFor(page, "Statistics");
    await expect(
        page.getByRole("button", { name: "Statistics", exact: true })
    ).toBeDisabled();
    await clickRibbon(page, "Metadata");
    await expect(widget.getByText("Loading metadata…")).toBeVisible();
    await writeFile(file + ".ready", "ready");
    await expect(widget.getByRole("img")).toBeVisible();
    await expect(widget.getByText("Test radar")).toBeVisible();
    await clickRibbon(page, "Statistics");
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
    await clickRibbon(page, "Add Image");

    const widget = page.getByRole("article", {
        name: "saved.test",
        exact: true
    });

    await expect(widget.getByRole("img")).toBeVisible();
    await widget
        .getByLabel("saved.test window title. Use arrow keys to move.")
        .press("Shift+ArrowRight");

    const bounds = await widget.boundingBox();

    await clickRibbon(page, "Close");
    await expect(widget).toHaveCount(0);
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(widget.getByRole("img")).toBeVisible();
    expect((await widget.boundingBox())!.x).toBe(bounds!.x);
    await clickRibbon(page, "Close");
    await rm(file);
    await clickRibbon(page, "Open");
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
    await clickRibbon(page, "New");
    await clickRibbon(page, "Open");
    await clickRibbon(page, "Add Image");
    await expect(page.getByRole("article")).toHaveCount(0);

    const canvas = page.getByRole("region", {
        name: "Image workspace",
        exact: true
    });
    const canvasBeforeError = await canvas.boundingBox();
    const invalid = path.join(profile, "invalid.scenario");

    await writeFile(invalid, "not sqlite");
    await chooseFile(application, invalid);
    await clickRibbon(page, "Open");
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await canvas.boundingBox()).toEqual(canvasBeforeError);
    await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await canvas.boundingBox()).toEqual(canvasBeforeError);
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
    ).toBeEnabled();

    const broken = path.join(profile, "slow-broken.test");

    await writeFile(broken, "bad");
    await chooseFile(application, broken);
    await clickRibbon(page, "Add Image");
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
    await clickRibbon(page, "Add Image");

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
        page.getByRole("button", { name: "Add Image", exact: true })
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
    await clickRibbon(page, "Add Image");
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
    await selectRibbonFor(page, "Statistics");
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
    await clickRibbon(page, "New");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
    ).toBeEnabled();
    await application.evaluate(({ BrowserWindow }) => {
        const ipc = BrowserWindow.getAllWindows()[0]!.webContents.ipc;

        ipc.removeHandler("scenario:close");
        ipc.handle("scenario:close", () => {
            throw new Error("Close failed");
        });
    });
    await clickRibbon(page, "Close");
    await expect(page.getByRole("alert")).toContainText("Close failed");
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
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
    await clickRibbon(page, "Add Image");
    await expect(page.getByRole("alert")).toContainText("Disk full");
    await clickRibbon(page, "Close");
    await expect(
        page.getByRole("article", { name: "unsaved.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Open");
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

    await clickRibbon(page, "Settings");

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
    await clickRibbon(page, "Add Image");

    const widget = page.getByRole("article", {
        name: "percentiles.test",
        exact: true
    });

    await expect(widget.getByRole("img")).toBeVisible();
    await clickRibbon(page, "Statistics");
    await expect(
        widget.getByText("50th percentile", { exact: true })
    ).toBeVisible();
    await expect(
        widget.getByText("90th percentile", { exact: true })
    ).toHaveCount(0);
    await clickRibbon(page, "Settings");

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
    await clickRibbon(page, "Settings");
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

test("visual slice strips preview the selected source line and open independent graphs", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const toggle = page.getByRole("button", { name: "Slice", exact: true });

    await expect(
        page.getByRole("tab", { name: /^(Scientific Imagery|Image)$/ })
    ).toHaveCount(0);
    await createScenario(application, page, profile);

    const file = path.join(profile, "slice.test");

    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "slice.test",
        exact: true
    });

    await expect(
        source.getByRole("img", { name: "slice.test", exact: true })
    ).toBeVisible();
    // Metadata narrows the image, creating letterboxing that must not affect row mapping.
    await clickRibbon(page, "Metadata");
    await selectRibbonFor(page, "Slice");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const left = source.getByRole("button", {
        name: "Horizontal slice selector for slice.test",
        exact: true
    });
    const bottom = source.getByRole("button", {
        name: "Vertical slice selector for slice.test",
        exact: true
    });

    await expect(left).toBeVisible();
    await expect(bottom).toBeVisible();

    const viewport = (await source.locator(".slice-viewport").boundingBox())!;
    const strip = (await left.boundingBox())!;
    const scale = Math.min(viewport.width / 40, viewport.height / 20);
    const top = (viewport.height - 20 * scale) / 2;

    expect(top).toBeGreaterThan(5);
    await page.mouse.move(strip.x + strip.width / 2, strip.y + 1);
    await expect(source.locator(".slice-line")).toHaveCount(0);

    const rowY = viewport.y + top + 3.5 * scale;

    await page.mouse.move(strip.x + strip.width / 2, rowY);
    await expect(source.locator(".slice-line")).toBeVisible();
    await expect(source.getByText("Row 3", { exact: true })).toBeVisible();

    const line = (await source.locator(".slice-line").boundingBox())!;

    expect(Math.abs(line.y - rowY)).toBeLessThan(2);
    await page.mouse.click(strip.x + strip.width / 2, rowY);

    const horizontal = page.getByRole("article", {
        name: "Horizontal slice: slice.test · row 3",
        exact: true
    });

    await expect(
        horizontal.getByRole("img", {
            name: "Source amplitude by Column (pixel)",
            exact: true
        })
    ).toBeVisible();
    await expect(toggle).toBeDisabled();
    await source
        .getByLabel("slice.test window title. Use arrow keys to move.")
        .click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await selectRibbonFor(page, "Slice");
    await toggle.click();
    await expect(left).toHaveCount(0);
    await selectRibbonFor(page, "Slice");
    await toggle.click();

    const area = (await source.locator(".slice-viewport").boundingBox())!;
    const below = (await bottom.boundingBox())!;
    const fitted = Math.min(area.width / 40, area.height / 20);
    const colX = area.x + (area.width - fitted * 40) / 2 + 2.5 * fitted;

    await page.mouse.move(colX, below.y + below.height / 2);
    await expect(source.getByText("Column 2", { exact: true })).toBeVisible();
    await page.mouse.click(colX, below.y + below.height / 2);

    const vertical = page.getByRole("article", {
        name: "Vertical slice: slice.test · column 2",
        exact: true
    });

    await expect(
        vertical.getByRole("img", {
            name: "Source amplitude by Row (pixel)",
            exact: true
        })
    ).toBeVisible();
    await vertical
        .getByRole("button", {
            name: "Close Vertical slice: slice.test · column 2",
            exact: true
        })
        .click();
    await expect(horizontal).toBeVisible();
});

test("SVG preview slices support keyboard selection and clearly label luminance", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();

    await createScenario(application, page, profile);

    const file = path.join(profile, "preview.svg");

    await writeFile(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="white"/></svg>'
    );
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "preview.svg",
        exact: true
    });

    await expect(
        source.getByRole("img", { name: "preview.svg", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Slice");

    const selector = source.getByRole("button", {
        name: "Vertical slice selector for preview.svg",
        exact: true
    });

    await selector.focus();
    await expect(source.getByText("Column 8", { exact: true })).toBeVisible();
    await selector.press("Enter");

    const graph = page.getByRole("article", {
        name: "Vertical slice: preview.svg · column 8",
        exact: true
    });

    await expect(
        graph.getByRole("img", {
            name: "Preview luminance (0–255) by Row (pixel)",
            exact: true
        })
    ).toBeVisible();
    await expect(graph).toContainText("8 samples");
});

test("dropping native files opens a scenario and images without an open dialog", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenarioPath = await createScenario(application, page, profile);

    await clickRibbon(page, "Close");

    const imagePath = path.join(profile, "dropped.test");

    await writeFile(imagePath, "test image");
    // File inputs supply native-backed File objects, so this exercises Electron's
    // webUtils path resolution as well as the renderer drop handler and IPC.
    await page.evaluate(() => {
        const input = document.createElement("input");

        input.type = "file";
        input.multiple = true;
        input.id = "drop-test-files";
        document.body.append(input);
    });
    await page
        .locator("#drop-test-files")
        .setInputFiles([imagePath, scenarioPath]);
    await page.evaluate(() => {
        const input =
            document.querySelector<HTMLInputElement>("#drop-test-files")!;
        const dataTransfer = new DataTransfer();

        for (const file of input.files!) {
            dataTransfer.items.add(file);
        }

        window.dispatchEvent(
            new DragEvent("drop", { dataTransfer, cancelable: true })
        );
        input.remove();
    });
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
    ).toBeEnabled();
    await expect(
        page.getByRole("img", { name: "dropped.test", exact: true })
    ).toBeVisible();
});
