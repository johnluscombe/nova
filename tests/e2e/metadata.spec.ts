import { clickRibbon } from "./helpers";
import { test, expect } from "./fixtures";
import { createScenario, chooseFile } from "./helpers";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

const axes = {
    row: { label: "Northing", unit: "m", origin: 100, spacing: 2 },
    column: { label: "Easting", unit: "m", origin: 200, spacing: 3 }
};
const json = JSON.stringify({
    width: 40,
    height: 20,
    axes,
    collection: "Test collection"
});

test.use({
    pluginFiles: {
        "test/plugin.json": JSON.stringify({
            apiVersion: 1,
            id: "test.metadata",
            name: "Test images",
            main: "index.ts",
            extensions: ["test"]
        }),
        "test/index.ts": `export default {
        open(file) {
            return {width: 40, height: 20, metadata: {Format: 'TIFF'},
                ...(file.includes('embedded') ? {axes: {row: {label: 'Down-range', unit: 'm', origin: -20, spacing: 2}, column: {label: 'Cross-range', unit: 'm', origin: -10, spacing: 0.5}}} : {}),
                previewDataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>').toString('base64')};
        },
        readSlice(file, orientation, index) {return {points: [{position: 0, value: 1}, {position: 3, value: 4}], positionLabel: 'Pixel', valueLabel: 'Intensity'};}
    };`
    }
});

test("multi-select shares JSON axes and late attachments persist with the scenario", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const a = path.join(profile, "alpha.test"),
        b = path.join(profile, "beta.test"),
        shared = path.join(profile, "shared.json"),
        extra = path.join(profile, "extra.json");

    await Promise.all([
        writeFile(a, "a"),
        writeFile(b, "b"),
        writeFile(shared, json),
        writeFile(extra, '{"note":"Attached later"}')
    ]);
    await application.evaluate(
        ({ dialog }, files) => {
            dialog.showOpenDialog = async () => ({
                canceled: false,
                filePaths: files
            });
        },
        [a, b, shared]
    );
    await clickRibbon(page, "Add Image");
    await expect(page.getByRole("article")).toHaveCount(2);

    const beta = page.getByRole("article", { name: "beta.test", exact: true });

    await expect(
        beta.getByRole("img", { name: "beta.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Axes");
    await expect(
        beta.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Metadata");
    await beta.getByText("shared.json", { exact: true }).click();
    await expect(beta.locator("pre")).toContainText("Test collection");
    await chooseFile(application, extra);
    await clickRibbon(page, "Attach Metadata");
    await beta.getByText("extra.json", { exact: true }).click();
    await expect(
        beta.getByRole("region", { name: "Attached JSON metadata" })
    ).toContainText("Attached later");
    await clickRibbon(page, "Close");
    await rm(extra);
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(
        beta.getByRole("img", { name: "beta.test", exact: true })
    ).toBeVisible();
    await beta
        .getByLabel("beta.test window title. Use arrow keys to move.")
        .click();
    await clickRibbon(page, "Axes");
    await expect(
        beta.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Metadata");
    await expect(
        beta.getByText("extra.json — unavailable", { exact: true })
    ).toBeVisible();
});

test("JSON axis override is explicit, updates existing slices and persists", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const file = path.join(profile, "embedded.test"),
        metadata = path.join(profile, "axes.json");

    await Promise.all([writeFile(file, "fixture"), writeFile(metadata, json)]);
    await application.evaluate(
        ({ dialog }, files) => {
            dialog.showOpenDialog = async () => ({
                canceled: false,
                filePaths: files
            });
        },
        [file, metadata]
    );
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "embedded.test",
        exact: true
    });

    await expect(
        source.getByRole("img", { name: "embedded.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Axes");
    await expect(
        source.getByRole("img", {
            name: "X axis: Cross-range (m)",
            exact: true
        })
    ).toBeVisible();
    await clickRibbon(page, "Slice");

    const strip = source.getByRole("button", {
        name: "Horizontal slice selector for embedded.test",
        exact: true
    });

    await strip.focus();
    await strip.press("Enter");
    await expect(
        page.getByRole("article", {
            name: "Horizontal slice: embedded.test · Down-range 0 m (row 10)",
            exact: true
        })
    ).toBeVisible();
    await source
        .getByLabel("embedded.test window title. Use arrow keys to move.")
        .click();
    await clickRibbon(page, "Metadata");
    await source.getByText("axes.json", { exact: true }).click();
    await source
        .getByRole("button", { name: "Override embedded axes", exact: true })
        .click();
    await expect(
        source.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();

    const graph = page.getByRole("article", {
        name: "Horizontal slice: embedded.test · Northing 120 m (row 10)",
        exact: true
    });

    await expect(
        graph.getByRole("img", {
            name: "Intensity by Easting (m)",
            exact: true
        })
    ).toBeVisible();
    await clickRibbon(page, "Close");
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(
        source.getByRole("img", { name: "embedded.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Axes");
    await expect(
        source.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Metadata");
    await source
        .getByRole("button", { name: "Use embedded axes", exact: true })
        .click();
    await expect(
        source.getByRole("img", {
            name: "X axis: Cross-range (m)",
            exact: true
        })
    ).toBeVisible();
});

test("ZIP images and JSON axes restore independently of the original archive", async ({
    application,
    profile
}) => {
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    const archive = path.join(profile, "collection.zip");

    await writeFile(
        archive,
        zipSync({
            "collection/first.test": strToU8("a"),
            "collection/second.test": strToU8("b"),
            "collection/metadata.json": strToU8(json)
        })
    );
    await chooseFile(application, archive);
    await clickRibbon(page, "Add Image");

    const source = page.getByRole("article", {
        name: "second.test",
        exact: true
    });

    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
        source.getByRole("img", { name: "second.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Axes");
    await expect(
        source.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Close");
    await rm(archive);
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(
        source.getByRole("img", { name: "second.test", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Axes");
    await expect(
        source.getByRole("img", { name: "X axis: Easting (m)", exact: true })
    ).toBeVisible();
});
