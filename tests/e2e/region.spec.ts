import { test, expect } from "./fixtures";
import { createScenario, chooseFile, clickRibbon } from "./helpers";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test("polygon drawing supports undo/cancel and preview region statistics", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    await createScenario(application, page, profile);
    const file = path.join(profile, "region.svg");
    await writeFile(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/><rect width="4" height="8" fill="black"/></svg>'
    );
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");
    const source = page.getByRole("article", {
        name: "region.svg",
        exact: true
    });
    await expect(
        source.getByRole("img", { name: "region.svg", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Statistics");
    const initialPane = source.getByRole("region", {
        name: "Image statistics",
        exact: true
    });
    await expect(initialPane).toContainText("Preview luminance (0–255)");
    await expect(
        initialPane
            .getByText("50th percentile", { exact: true })
            .locator("..")
            .locator("dd")
    ).toHaveText("127.5");
    await source
        .getByRole("button", { name: "Close statistics", exact: true })
        .click();
    await expect(initialPane).toHaveCount(0);
    await clickRibbon(page, "Polygon");
    const viewport = source.locator(".slice-viewport");
    const bounds = (await viewport.boundingBox())!;
    const scale = Math.min(bounds.width / 8, bounds.height / 8),
        left = bounds.x + (bounds.width - 8 * scale) / 2,
        top = bounds.y + (bounds.height - 8 * scale) / 2;
    await page.mouse.click(left + scale, top + scale);
    await expect(source.locator(".draft-polygon")).toBeVisible();
    await viewport.press("Backspace");
    await expect(source.locator(".draft-polygon")).toHaveCount(0);
    await viewport.press("Escape");
    await expect(
        page.getByRole("button", { name: "Polygon", exact: true })
    ).toHaveAttribute("aria-pressed", "false");
    await clickRibbon(page, "Polygon");
    for (const [column, row] of [
        [0.1, 0.1],
        [3.9, 0.1],
        [3.9, 7.9],
        [0.1, 7.9]
    ]) {
        await page.mouse.click(left + column! * scale, top + row! * scale);
    }
    await viewport.press("Enter");
    const pane = source.getByRole("region", {
        name: "Image statistics",
        exact: true
    });
    await expect(pane).toContainText("Preview luminance (0–255)");
    await expect(pane).toContainText("32 finite samples");
    const median = pane
        .getByText("50th percentile", { exact: true })
        .locator("..")
        .locator("dd");
    await expect(median).toHaveText("0");
    await clickRibbon(page, "Metadata");
    await expect(source.locator(".closed-polygon")).toBeVisible();
    await clickRibbon(page, "Clear Region");
    await expect(median).toHaveText("127.5");
    await expect(pane).toContainText("Preview luminance (0–255)");
    await expect(source.locator(".closed-polygon")).toHaveCount(0);
});
