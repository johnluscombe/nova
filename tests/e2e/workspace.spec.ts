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
        ribbon.getByRole("button", { name: "Statistics", exact: true })
    ).toBeDisabled();
    await expect(
        ribbon.getByRole("button", { name: "Add Image", exact: true })
    ).toBeDisabled();
    const scenarioPath = path.join(profile, "test.scenario");
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, scenarioPath);
    await ribbon.getByRole("button", { name: "New", exact: true }).click();
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
    await ribbon
        .getByRole("button", { name: "Add Image", exact: true })
        .click();
    const widget = page.getByRole("article", {
        name: "sample.png",
        exact: true
    });
    await expect(widget.getByRole("img", { name: "sample.png" })).toBeVisible();
    await expect(
        ribbon.getByRole("button", { name: "Statistics", exact: true })
    ).toBeDisabled();
    await ribbon.getByRole("button", { name: "Metadata", exact: true }).click();
    await expect(
        widget.getByRole("complementary", { name: "Image metadata" })
    ).toBeVisible();
    await expect(widget.getByText(imagePath, { exact: true })).toBeVisible();
});
