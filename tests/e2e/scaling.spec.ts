import { clickRibbon, selectRibbonFor } from "./helpers";
import { test, expect } from "./fixtures";
import { createScenario, chooseFile } from "./helpers";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test.use({
    pluginFiles: {
        "scaling/plugin.json": JSON.stringify({
            apiVersion: 1,
            id: "test.scaling",
            name: "Complex test",
            main: "index.ts",
            extensions: ["complex"]
        }),
        "scaling/index.ts": `export default {
            open(file, parameters, scaling = 'amplitude') {
                if (scaling === 'imaginary') throw new Error('Scaling reader failure');
                const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="' + (scaling === 'real' ? 'red' : 'blue') + '"/></svg>';
                return {width: 40, height: 20, axes: {row: {label: 'Down-range', unit: 'm', origin: -20, spacing: 2}, column: {label: 'Cross-range', unit: 'm', origin: -10, spacing: 0.5}}, scaling, scalingOptions: ['amplitude', 'real', 'imaginary', 'phase', 'power', 'log-power', 'relative-power'],
                    previewDataUrl: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
                    metadata: {Scaling: scaling}, statistics: {'50th percentile': scaling === 'real' ? -3 : 5}};
            },
            readPixel(file, row, column, parameters, scaling = 'amplitude') {
                return {value: scaling === 'real' ? -3 : row * 40 + column, valueLabel: scaling === 'real' ? 'Real component' : 'Source amplitude'};
            },
            readSlice(file, orientation, index, parameters, scaling = 'amplitude') {
                return {points: [{position: 0, value: scaling === 'real' ? -3 : 25}, {position: 1, value: 4}], positionLabel: 'Column (pixel)', valueLabel: scaling};
            }
        };`
    }
});

test("scaling updates previews, statistics and graphs, preserves failures and restores saved modes", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scaling = page.getByRole("button", { name: "Scaling", exact: true });

    await expect(
        page.getByRole("tab", { name: /^(Scientific Imagery|Image)$/ })
    ).toHaveCount(0);

    const scenarioPath = await createScenario(application, page, profile);
    const file = path.join(profile, "radar.complex");

    await writeFile(file, "complex fixture");
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "radar.complex",
        exact: true
    });
    const preview = source.getByRole("img", {
        name: "radar.complex",
        exact: true
    });

    await expect(preview).toBeVisible();

    const original = await preview.getAttribute("src");

    await selectRibbonFor(page, "Scaling");
    await scaling.click();
    await expect(
        page.getByRole("menuitemradio", { name: "RCS (m²)", exact: true })
    ).toHaveAttribute("aria-disabled", "true");
    await page
        .getByRole("menuitemradio", { name: "Real", exact: true })
        .click();
    await expect(preview).not.toHaveAttribute("src", original!);

    const real = await preview.getAttribute("src");

    await clickRibbon(page, "Statistics");
    await expect(source.getByText("-3", { exact: true })).toBeVisible();
    await selectRibbonFor(page, "Scaling");
    await scaling.click();
    await expect(
        page.getByRole("menuitemradio", { name: "Real", exact: true })
    ).toHaveAttribute("aria-checked", "true");
    await page
        .getByRole("menuitemradio", { name: "Imaginary", exact: true })
        .click();
    await expect(page.getByRole("alert")).toContainText(
        "Scaling reader failure"
    );
    await expect(preview).toHaveAttribute("src", real!);
    await clickRibbon(page, "Slice");

    const strip = source.getByRole("button", {
        name: "Vertical slice selector for radar.complex",
        exact: true
    });

    await strip.focus();
    await strip.press("Enter");

    const graph = page.getByRole("article", {
        name: "Vertical slice: radar.complex · Cross-range 0 m (column 20)",
        exact: true
    });

    await expect(
        graph.getByRole("img", { name: "real by Down-range (m)", exact: true })
    ).toBeVisible();
    await selectRibbonFor(page, "Scaling");
    await scaling.click();
    await page
        .getByRole("menuitemradio", { name: "Linear power", exact: true })
        .click();
    await expect(
        graph.getByRole("img", { name: "power by Down-range (m)", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Close");
    await chooseFile(application, scenarioPath);
    await clickRibbon(page, "Open");
    await expect(preview).toHaveAttribute("src", real!);
    await expect(page.getByRole("article")).toHaveCount(1);
    await selectRibbonFor(page, "Scaling");
    await scaling.click();
    await expect(
        page.getByRole("menuitemradio", { name: "Real", exact: true })
    ).toHaveAttribute("aria-checked", "true");
});

test("pixel inspection follows fitted coordinates, selected scaling and preview fallback", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const toggle = page.getByRole("button", {
        name: "Pixel Values",
        exact: true
    });

    await expect(toggle).toHaveCount(0);
    await createScenario(application, page, profile);

    const file = path.join(profile, "hover.complex");

    await writeFile(file, "complex fixture");
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "hover.complex",
        exact: true
    });

    await expect(
        source.getByRole("img", { name: "hover.complex", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Metadata");
    await selectRibbonFor(page, "Pixel Values");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const viewport = (await source.locator(".slice-viewport").boundingBox())!;
    const scale = Math.min(viewport.width / 40, viewport.height / 20);
    const top = (viewport.height - 20 * scale) / 2;
    const left = (viewport.width - 40 * scale) / 2;

    await page.mouse.move(
        viewport.x + left + 5.5 * scale,
        viewport.y + top + 3.5 * scale
    );
    await expect(async () => {
        await page.mouse.move(
            viewport.x + left + 5.5 * scale,
            viewport.y + top + 3.5 * scale
        );
        await expect(source.getByRole("status")).toContainText(
            "Row 3 · Column 5"
        );
        await expect(source.getByRole("status")).toContainText(
            "Source amplitude: 125",
            { timeout: 1000 }
        );
    }).toPass();
    await page.mouse.move(viewport.x + 1, viewport.y + 1);
    await expect(source.locator(".pixel-readout")).toHaveCount(0);
    await clickRibbon(page, "Scaling");
    await page
        .getByRole("menuitemradio", { name: "Real", exact: true })
        .click();
    await expect(
        page.getByRole("menuitemradio", { name: "Real", exact: true })
    ).toBeHidden();
    await expect(
        source.getByRole("img", { name: "hover.complex", exact: true })
    ).toBeVisible();
    await page.mouse.move(
        viewport.x + left + 5.5 * scale,
        viewport.y + top + 3.5 * scale
    );
    await expect(source.getByRole("status")).toContainText(
        "Real component: -3"
    );
    await selectRibbonFor(page, "Pixel Values");
    await toggle.click();
    await expect(source.locator(".pixel-readout")).toHaveCount(0);

    const svg = path.join(profile, "red.svg");

    await writeFile(
        svg,
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>'
    );
    await chooseFile(application, svg);
    await clickRibbon(page, "Add Image");

    const raster = page.getByRole("article", { name: "red.svg", exact: true });

    await expect(
        raster.getByRole("img", { name: "red.svg", exact: true })
    ).toBeVisible();
    await selectRibbonFor(page, "Pixel Values");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();

    const bounds = (await raster.locator(".slice-viewport").boundingBox())!;

    await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
    );
    await expect(raster.getByRole("status")).toContainText("Row 4 · Column 8");
    await expect(raster.getByRole("status")).toContainText(
        "Preview luminance (0–255): 54.213"
    );
});

test("image axes display source distances and remain aligned with slicing and hover", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const toggle = page.getByRole("button", { name: "Axes", exact: true });

    await expect(toggle).toHaveCount(0);
    await createScenario(application, page, profile);

    const file = path.join(profile, "axes.complex");

    await writeFile(file, "fixture");
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "axes.complex",
        exact: true
    });

    await expect(
        source.getByRole("img", { name: "axes.complex", exact: true })
    ).toBeVisible();
    await expect(source.locator(".image-axis")).toHaveCount(0);
    await selectRibbonFor(page, "Axes");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const x = source.getByRole("img", {
        name: "X axis: Cross-range (m)",
        exact: true
    });
    const y = source.getByRole("img", {
        name: "Y axis: Down-range (m)",
        exact: true
    });

    await expect(x).toBeVisible();
    await expect(y).toBeVisible();
    await expect(x.locator("text").first()).toHaveText("-10");
    await expect(x.locator("g text").last()).toHaveText("9.5");
    await expect(y.locator("text").first()).toHaveText("-20");
    await expect(y.locator("g text").last()).toHaveText("18");
    await clickRibbon(page, "Metadata");
    await clickRibbon(page, "Slice");
    await clickRibbon(page, "Pixel Values");

    const viewport = (await source.locator(".slice-viewport").boundingBox())!;
    const scale = Math.min(viewport.width / 40, viewport.height / 20);
    const top = (viewport.height - 20 * scale) / 2;
    const left = (viewport.width - 40 * scale) / 2;
    const axisBox = (await x.boundingBox())!;
    const baseline = x.locator("line").first();

    expect(
        Math.abs(
            axisBox.x +
                Number(await baseline.getAttribute("x1")) -
                viewport.x -
                left
        )
    ).toBeLessThan(1);
    await page.mouse.move(
        viewport.x + left + 5.5 * scale,
        viewport.y + top + 3.5 * scale
    );
    await expect(source.getByRole("status")).toContainText("Row 3 · Column 5");
    await expect(source.getByRole("status")).toContainText(
        "Down-range: -14 m · Cross-range: -7.5 m"
    );
    await expect(source.getByRole("status")).toContainText(
        "Source amplitude: 125"
    );

    const rowStrip = source.getByRole("button", {
        name: "Horizontal slice selector for axes.complex",
        exact: true
    });

    await expect(rowStrip).toContainText("Down-range");
    await rowStrip.focus();
    await expect(source.locator(".slice-index")).toHaveText(
        "Down-range 0 m (row 10)"
    );
    await rowStrip.press("Enter");

    const title = "Horizontal slice: axes.complex · Down-range 0 m (row 10)";
    const graph = page.getByRole("article", { name: title, exact: true });

    await expect(
        graph.getByRole("img", {
            name: "amplitude by Cross-range (m)",
            exact: true
        })
    ).toBeVisible();
    await expect(graph.locator("svg text")).toContainText(["-10"]);
    await graph
        .getByRole("button", { name: `Close ${title}`, exact: true })
        .click();
    await source
        .getByLabel("axes.complex window title. Use arrow keys to move.")
        .click();
    await selectRibbonFor(page, "Axes");
    await toggle.click();
    await expect(source.locator(".image-axis")).toHaveCount(0);

    const svg = path.join(profile, "axes.svg");

    await writeFile(
        svg,
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>'
    );
    await chooseFile(application, svg);
    await clickRibbon(page, "Add Image");

    const raster = page.getByRole("article", { name: "axes.svg", exact: true });

    await expect(
        raster.getByRole("img", { name: "axes.svg", exact: true })
    ).toBeVisible();
    await selectRibbonFor(page, "Axes");
    await toggle.click();
    await expect(
        raster.getByRole("img", { name: "X axis: Column (pixel)", exact: true })
    ).toBeVisible();
    await expect(
        raster.getByRole("img", { name: "Y axis: Row (pixel)", exact: true })
    ).toBeVisible();
});
