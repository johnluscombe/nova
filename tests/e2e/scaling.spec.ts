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
    await page.getByRole("button", { name: "Open image", exact: true }).click();
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
