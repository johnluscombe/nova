import { test, expect } from "./fixtures";
import { clickRibbon, createScenario, chooseFile } from "./helpers";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test("color scale clips luminance, persists per image, exports colors, and resets", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const file = path.join(profile, "colors.svg");

    await writeFile(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="1"><rect width="1" height="1" fill="black"/><rect x="1" width="1" height="1" fill="#808080"/><rect x="2" width="1" height="1" fill="white"/></svg>'
    );
    await chooseFile(application, file);
    await clickRibbon(page, "Add Image");
    const image = page.getByRole("img", { name: "colors.svg", exact: true });

    await expect(image).toBeVisible();
    await clickRibbon(page, "Color Scale");
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Palette", { exact: true }).click();
    await page.getByRole("option", { name: "Rainbow", exact: true }).click();
    await expect(dialog.locator('input[type="color"]').first()).toHaveValue(
        "#ff0000"
    );
    await expect(dialog.locator('input[type="color"]').last()).toHaveValue(
        "#8000ff"
    );
    await expect(
        dialog.getByLabel("Maximum color", { exact: true })
    ).toHaveValue("#ff0000");
    await expect(
        dialog.getByLabel("Minimum color", { exact: true })
    ).toHaveValue("#8000ff");
    await dialog.getByLabel("Palette", { exact: true }).click();
    await page.getByRole("option", { name: "Grayscale", exact: true }).click();
    await dialog.getByLabel("Minimum", { exact: true }).fill("64");
    await dialog.getByLabel("Maximum", { exact: true }).fill("192");
    await dialog
        .getByLabel("Choose minimum color", { exact: true })
        .fill("#0000ff");
    await dialog
        .getByLabel("Choose maximum color", { exact: true })
        .fill("#ff0000");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    const readPixels = () =>
        image.evaluate((element: HTMLImageElement) => {
            const canvas = document.createElement("canvas");

            canvas.width = 3;
            canvas.height = 1;
            const context = canvas.getContext("2d")!;

            context.drawImage(element, 0, 0);
            return [...context.getImageData(0, 0, 3, 1).data];
        });
    const colored = [0, 0, 255, 255, 128, 0, 128, 255, 255, 0, 0, 255];

    await expect.poll(readPixels).toEqual(colored);
    const output = path.join(profile, "colored.png");

    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, output);
    await clickRibbon(page, "Save");
    await expect
        .poll(() =>
            application.evaluate(
                ({ nativeImage }, filePath) => [
                    ...nativeImage.createFromPath(filePath).toBitmap()
                ],
                output
            )
        )
        .toEqual([255, 0, 0, 255, 128, 0, 128, 255, 0, 0, 255, 255]);
    await clickRibbon(page, "Close");
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(image).toBeVisible();
    await expect.poll(readPixels).toEqual(colored);
    await clickRibbon(page, "Color Scale");
    await expect(dialog.getByLabel("Minimum", { exact: true })).toHaveValue(
        "64"
    );
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect
        .poll(readPixels)
        .toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
});
