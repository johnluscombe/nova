import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "./fixtures";
import path from "node:path";

export async function createScenario(
    application: ElectronApplication,
    page: Page,
    profile: string
) {
    const file = path.join(profile, "test.scenario");
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, file);
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
    ).toBeEnabled();
    return file;
}
export async function chooseFile(
    application: ElectronApplication,
    file: string
) {
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [filePath]
        });
    }, file);
}

/** Select the tab that owns a built-in ribbon control. */
export async function selectRibbonFor(page: Page, label: string) {
    const imageTools = [
        "Attach Metadata",
        "Form SICD",
        "Statistics",
        "Scaling",
        "Slice",
        "Polygon",
        "Clear Region"
    ].includes(label);
    await page
        .getByRole("tab", {
            name: imageTools ? /^(Scientific Imagery|Image)$/ : "Home",
            exact: true
        })
        .click();
}
export async function clickRibbon(page: Page, label: string) {
    await selectRibbonFor(page, label);
    await page.getByRole("button", { name: label, exact: true }).click();
}
