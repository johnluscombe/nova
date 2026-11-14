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
                return {width: 40, height: 20, scaling, scalingOptions: ['amplitude', 'real', 'imaginary', 'phase', 'power', 'log-power', 'relative-power'],
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
    await expect(scaling).toBeDisabled();
    const scenarioPath = await createScenario(application, page, profile);
    const file = path.join(profile, "radar.complex");
    await writeFile(file, "complex fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Add Image", exact: true }).click();
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
    await scaling.click();
    await expect(
        page.getByRole("menuitemradio", { name: "RCS (m²)", exact: true })
    ).toHaveAttribute("aria-disabled", "true");
    await page
        .getByRole("menuitemradio", { name: "Real", exact: true })
        .click();
    await expect(preview).not.toHaveAttribute("src", original!);
    const real = await preview.getAttribute("src");
    await page.getByRole("button", { name: "Statistics", exact: true }).click();
    await expect(source.getByText("-3", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Slice", exact: true }).click();
    const strip = source.getByRole("button", {
        name: "Vertical slice selector for radar.complex",
        exact: true
    });
    await strip.focus();
    await strip.press("Enter");
    const graph = page.getByRole("article", {
        name: "Vertical slice: radar.complex · column 20",
        exact: true
    });
    await expect(
        graph.getByRole("img", { name: "real by Column (pixel)", exact: true })
    ).toBeVisible();
    await scaling.click();
    await page
        .getByRole("menuitemradio", { name: "Linear power", exact: true })
        .click();
    await expect(
        graph.getByRole("img", { name: "power by Column (pixel)", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await chooseFile(application, scenarioPath);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(preview).toHaveAttribute("src", real!);
    await expect(page.getByRole("article")).toHaveCount(1);
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
    await expect(toggle).toBeDisabled();
    await createScenario(application, page, profile);
    const file = path.join(profile, "hover.complex");
    await writeFile(file, "complex fixture");
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Add Image", exact: true }).click();
    const source = page.getByRole("article", {
        name: "hover.complex",
        exact: true
    });
    await expect(
        source.getByRole("img", { name: "hover.complex", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Metadata", exact: true }).click();
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
    await expect(source.getByRole("status")).toContainText("Row 3 · Column 5");
    await expect(source.getByRole("status")).toContainText(
        "Source amplitude: 125"
    );
    await page.mouse.move(viewport.x + 1, viewport.y + 1);
    await expect(source.locator(".pixel-readout")).toHaveCount(0);
    await page.getByRole("button", { name: "Scaling", exact: true }).click();
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
    await toggle.click();
    await expect(source.locator(".pixel-readout")).toHaveCount(0);
    const svg = path.join(profile, "red.svg");
    await writeFile(
        svg,
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>'
    );
    await chooseFile(application, svg);
    await page.getByRole("button", { name: "Add Image", exact: true }).click();
    const raster = page.getByRole("article", { name: "red.svg", exact: true });
    await expect(
        raster.getByRole("img", { name: "red.svg", exact: true })
    ).toBeVisible();
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
