import {
    clickRibbon,
    selectRibbonFor,
    createScenario,
    chooseFile
} from "./helpers";
import { test, expect } from "./fixtures";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test("creates a scenario, opens a raster widget, and shows metadata", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const ribbon = page.getByRole("region", { name: "Scenario ribbon" });

    // The ribbon is a labelled section and native dialogs are stubbed in main.
    await expect(
        page.getByRole("tab", { name: /^(Scientific Imagery|Image)$/ })
    ).toHaveCount(0);
    await expect(
        ribbon.getByRole("button", { name: "Add Image", exact: true })
    ).toBeDisabled();

    const scenarioPath = path.join(profile, "test.scenario");

    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, scenarioPath);
    await clickRibbon(page, "New");
    await expect(
        ribbon.getByRole("button", { name: "Add Image", exact: true })
    ).toBeEnabled();

    const imagePath = path.join(profile, "sample.png");
    const png = await application.evaluate(({ nativeImage }) => {
        const pixels = Buffer.alloc(16, 0);

        pixels.fill(255, 12); // One white pixel; three transparent pixels.

        return nativeImage
            .createFromBitmap(pixels, { width: 2, height: 2 })
            .toPNG()
            .toString("base64");
    });

    await writeFile(imagePath, Buffer.from(png, "base64"));
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [filePath]
        });
    }, imagePath);
    await clickRibbon(page, "Add Image");

    const widget = page.getByRole("article", {
        name: "sample.png",
        exact: true
    });

    await expect(widget.getByRole("img", { name: "sample.png" })).toBeVisible();
    await selectRibbonFor(page, "Statistics");
    await expect(
        ribbon.getByRole("button", { name: "Statistics", exact: true })
    ).toBeEnabled();
    await clickRibbon(page, "Statistics");

    const statistics = widget.getByRole("region", {
        name: "Image statistics",
        exact: true
    });

    await expect(statistics).toContainText("Preview luminance (0–255)");
    await expect(
        statistics
            .getByText("50th percentile", { exact: true })
            .locator("..")
            .locator("dd")
    ).toHaveText("255");
    await clickRibbon(page, "Metadata");
    await expect(
        widget.getByRole("complementary", { name: "Image metadata" })
    ).toBeVisible();
    await expect(widget.getByText(imagePath, { exact: true })).toBeVisible();
});

test("JPEG statistics are available immediately and recomputed on scenario restore", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const imagePath = path.join(profile, "gray.jpg");
    const jpeg = await application.evaluate(({ nativeImage }) => {
        const pixels = Buffer.alloc(8 * 8 * 4, 128);

        for (let i = 3; i < pixels.length; i += 4) {
            pixels[i] = 255;
        }

        return nativeImage
            .createFromBitmap(pixels, { width: 8, height: 8 })
            .toJPEG(100)
            .toString("base64");
    });

    await writeFile(imagePath, Buffer.from(jpeg, "base64"));
    await chooseFile(application, imagePath);
    await clickRibbon(page, "Add Image");

    const widget = page.getByRole("article", { name: "gray.jpg", exact: true });

    await expect(
        widget.getByRole("img", { name: "gray.jpg", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Statistics");

    const pane = widget.getByRole("region", {
        name: "Image statistics",
        exact: true
    });
    const median = pane
        .getByText("50th percentile", { exact: true })
        .locator("..")
        .locator("dd");

    await expect(median).toHaveText("128");
    await expect(widget.locator(".closed-polygon")).toHaveCount(0);
    await clickRibbon(page, "Close");
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(
        widget.getByRole("img", { name: "gray.jpg", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Statistics");
    await expect(median).toHaveText("128");
    await expect(pane).toContainText("Preview luminance (0–255)");
});
