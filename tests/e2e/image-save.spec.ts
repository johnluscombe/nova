import { test, expect } from "./fixtures";
import { clickRibbon, createScenario, chooseFile } from "./helpers";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

test("Save always prompts and preserves native bytes or converts the selected output format", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const source = path.join(profile, "original.svg");
    const first = path.join(profile, "saved.svg");
    const second = path.join(profile, "another.svg");
    const contents =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="red"/></svg>';

    await createScenario(application, page, profile);
    await writeFile(source, contents);
    await chooseFile(application, source);
    await clickRibbon(page, "Add Image");
    await expect(page.getByRole("img")).toBeVisible();
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, first);
    await clickRibbon(page, "Save");
    await expect
        .poll(async () => readFile(first, "utf8").catch(() => ""))
        .toBe(contents);
    await writeFile(first, "replace me");
    await application.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({
            canceled: true,
            filePath: ""
        });
    });
    await clickRibbon(page, "Save");
    await expect(
        page.getByRole("button", { name: "Save", exact: true })
    ).toBeEnabled();
    expect(await readFile(first, "utf8")).toBe("replace me");
    await expect(
        page.getByRole("button", { name: "Save As", exact: true })
    ).toHaveCount(0);
    await application.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, second);
    await clickRibbon(page, "Save");
    await expect
        .poll(async () => readFile(second, "utf8").catch(() => ""))
        .toBe(contents);
    const png = path.join(profile, "vector.png");
    const jpeg = path.join(profile, "vector.jpg");

    for (const output of [png, jpeg]) {
        await application.evaluate(({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await clickRibbon(page, "Save");
        await expect
            .poll(async () =>
                readFile(output)
                    .then(bytes => bytes.length)
                    .catch(() => 0)
            )
            .toBeGreaterThan(0);
        expect(
            await application.evaluate(
                ({ nativeImage }, filePath) =>
                    nativeImage.createFromPath(filePath).getSize(),
                output
            )
        ).toEqual({ width: 16, height: 12 });
    }
    expect(await readFile(source, "utf8")).toBe(contents);
});
