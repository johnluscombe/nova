import { test, expect } from "./fixtures";
import { createScenario, chooseFile } from "./helpers";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const folder = path.resolve("src-electron/electron-assets/plugins/sicd");
const manifest = JSON.parse(
    readFileSync(path.join(folder, "plugin.json"), "utf8")
);
const configured = String(manifest.parameters.python).replace(
    /^~(?=[/\\])/,
    homedir()
);
const python = existsSync(configured)
    ? configured
    : process.platform === "win32"
      ? "python"
      : "python3";
const execute = promisify(execFile);
test.use({
    pluginFiles: {
        "sicd/plugin.json": JSON.stringify({
            ...manifest,
            parameters: { python }
        }),
        "sicd/index.ts": readFileSync(path.join(folder, "index.ts"), "utf8"),
        "sicd/reader.py": readFileSync(path.join(folder, "reader.py"), "utf8")
    }
});

test("SIDD products open through the radar plugin with source inspection and slicing", async ({
    application,
    profile
}) => {
    try {
        await execute(python, ["-c", "import sarpy, numpy"]);
    } catch {
        test.skip(
            true,
            "SIDD integration requires Python with the radar plugin requirements installed."
        );
    }
    const file = path.join(profile, "derived.sidd");
    await execute(python, [
        "-c",
        `import importlib.util, pathlib, sys, numpy as np
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixtures', sys.argv[1])
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
fixtures.SiddReaderTests().fixture(pathlib.Path(sys.argv[2]), np.arange(32, dtype='uint16').reshape(4,8) * 1000, 'MONO16I')`,
        path.resolve("src-electron/sidd-reader.test.py"),
        file
    ]);
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    await chooseFile(application, file);
    await page.getByRole("button", { name: "Add Image", exact: true }).click();
    const source = page.getByRole("article", {
        name: "derived.sidd",
        exact: true
    });
    await expect(
        source.getByRole("img", { name: "derived.sidd", exact: true })
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Scaling", exact: true })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Metadata", exact: true }).click();
    await expect(
        source.getByRole("complementary", { name: "Image metadata" })
    ).toContainText("SIDD / NITF");
    await expect(source).toContainText("MONO16I");
    await page
        .getByRole("button", { name: "Pixel Values", exact: true })
        .click();
    const bounds = (await source.locator(".slice-viewport").boundingBox())!;
    const scale = Math.min(bounds.width / 8, bounds.height / 4);
    await page.mouse.move(
        bounds.x + (bounds.width - 8 * scale) / 2 + 3.5 * scale,
        bounds.y + (bounds.height - 4 * scale) / 2 + 2.5 * scale
    );
    await expect(source.getByRole("status")).toContainText("Row 2 · Column 3");
    await expect(source.getByRole("status")).toContainText(
        "Derived image intensity: 19000"
    );
    await page.getByRole("button", { name: "Slice", exact: true }).click();
    const strip = source.getByRole("button", {
        name: "Horizontal slice selector for derived.sidd",
        exact: true
    });
    await strip.focus();
    await strip.press("Enter");
    const graph = page.getByRole("article", {
        name: "Horizontal slice: derived.sidd · row 2",
        exact: true
    });
    await expect(
        graph.getByRole("img", {
            name: "Derived image intensity by Column (pixel)",
            exact: true
        })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await chooseFile(application, scenario);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(
        source.getByRole("img", { name: "derived.sidd", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
});
