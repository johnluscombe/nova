import { clickRibbon, selectRibbonFor } from "./helpers";
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
    const png = await application.evaluate(({ nativeImage }) =>
        nativeImage
            .createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 })
            .toPNG()
            .toString("base64")
    );
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
    ).toBeDisabled();
    await clickRibbon(page, "Metadata");
    await expect(
        widget.getByRole("complementary", { name: "Image metadata" })
    ).toBeVisible();
    await expect(widget.getByText(imagePath, { exact: true })).toBeVisible();
});
