import { test, expect } from "./fixtures";
import { clickRibbon, createScenario, chooseFile } from "./helpers";
import { writeFile } from "node:fs/promises";
import path from "node:path";

for (const format of ["png", "svg"]) {
    test(`crops ${format} source pixels into another window and restores the crop`, async ({
        application,
        profile
    }) => {
        const page = await application.firstWindow();
        const scenario = await createScenario(application, page, profile);
        const file = path.join(profile, `source.${format}`);

        if (format === "png") {
            const data = await application.evaluate(({ nativeImage }) =>
                nativeImage
                    .createFromBitmap(Buffer.alloc(16 * 12 * 4, 255), {
                        width: 16,
                        height: 12
                    })
                    .toPNG()
                    .toString("base64")
            );

            await writeFile(file, Buffer.from(data, "base64"));
        } else {
            await writeFile(
                file,
                '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="red"/></svg>'
            );
        }

        await chooseFile(application, file);
        await clickRibbon(page, "Add Image");

        const source = page.getByRole("article", {
            name: `source.${format}`,
            exact: true
        });

        await expect(source.getByRole("img")).toBeVisible();
        await clickRibbon(page, "Crop");
        await source.locator(".slice-viewport").press("Escape");
        await expect(
            page.getByRole("button", { name: "Crop", exact: true })
        ).toHaveAttribute("aria-pressed", "false");
        await clickRibbon(page, "Crop");

        const viewport = (await source
            .locator(".slice-viewport")
            .boundingBox())!;
        const scale = Math.min(viewport.width / 16, viewport.height / 12);
        const left = viewport.x + (viewport.width - 16 * scale) / 2;
        const top = viewport.y + (viewport.height - 12 * scale) / 2;

        await page.mouse.move(left + 2.1 * scale, top + 3.1 * scale);
        await page.mouse.down();
        await page.mouse.move(left + 9.9 * scale, top + 8.9 * scale);
        await page.mouse.up();
        await expect(source.getByLabel("Crop selection")).toBeVisible();
        await source
            .getByRole("button", { name: "Create Crop", exact: true })
            .click();

        const cropped = page.getByRole("article", {
            name: `source-crop.${format}`,
            exact: true
        });
        const preview = cropped.getByRole("img");

        await expect(preview).toBeVisible();
        await expect
            .poll(() =>
                preview.evaluate((image: HTMLImageElement) => [
                    image.naturalWidth,
                    image.naturalHeight
                ])
            )
            .toEqual([8, 6]);
        await expect
            .poll(() =>
                preview.evaluate((image: HTMLImageElement) => {
                    const canvas = document.createElement("canvas");

                    canvas.width = 8;
                    canvas.height = 6;

                    const context = canvas.getContext("2d")!;

                    context.drawImage(image, 0, 0);

                    return [...context.getImageData(4, 3, 1, 1).data];
                })
            )
            .toEqual(
                format === "png" ? [255, 255, 255, 255] : [255, 0, 0, 255]
            );
        await expect(source).toBeVisible();
        await clickRibbon(page, "Close");
        await chooseFile(application, scenario);
        await clickRibbon(page, "Open");
        await expect(preview).toBeVisible();
        await expect(source.getByRole("img")).toBeVisible();
    });
}
