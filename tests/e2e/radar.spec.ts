import { clickRibbon, selectRibbonFor } from "./helpers";
import { test, expect } from "./fixtures";
import { createScenario, chooseFile } from "./helpers";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const folder = path.resolve(
    "src-electron/electron-assets/plugins/scientific-imagery"
);
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
        "scientific-imagery/plugin.json": JSON.stringify({
            ...manifest,
            parameters: { ...manifest.parameters, python }
        }),
        "scientific-imagery/index.ts": readFileSync(
            path.join(folder, "index.ts"),
            "utf8"
        ),
        "scientific-imagery/reader.py": readFileSync(
            path.join(folder, "reader.py"),
            "utf8"
        )
    }
});

test("SIDD products open through Scientific Imagery with source inspection and slicing", async ({
    application,
    profile
}) => {
    try {
        await execute(python, ["-c", "import sarpy, numpy"]);
    } catch {
        test.skip(
            true,
            "SIDD integration requires Python with the Scientific Imagery requirements installed."
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
    await clickRibbon(page, "Add Image");
    const source = page.getByRole("article", {
        name: "derived.sidd",
        exact: true
    });
    await expect(
        source.getByRole("img", { name: "derived.sidd", exact: true })
    ).toBeVisible();
    await selectRibbonFor(page, "Scaling");
    await expect(
        page.getByRole("button", { name: "Scaling", exact: true })
    ).toBeDisabled();
    await clickRibbon(page, "Metadata");
    await expect(
        source.getByRole("complementary", { name: "Image metadata" })
    ).toContainText("SIDD / NITF");
    await expect(source).toContainText("MONO16I");
    await clickRibbon(page, "Pixel Values");
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
    await clickRibbon(page, "Slice");
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
    await clickRibbon(page, "Close");
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(
        source.getByRole("img", { name: "derived.sidd", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
});

test("TIFF images open with 16-bit source values and color previews", async ({
    application,
    profile
}) => {
    try {
        await execute(python, ["-c", "import PIL, numpy"]);
    } catch {
        test.skip(
            true,
            "TIFF integration requires Python with Pillow and NumPy installed."
        );
    }
    const mono = path.join(profile, "intensity.tif");
    const color = path.join(profile, "color.tiff");
    await execute(python, [
        "-c",
        `import sys, numpy as np
from PIL import Image
Image.fromarray(np.arange(32,dtype='uint16').reshape(4,8) * 1000).save(sys.argv[1],compression='tiff_lzw')
Image.new('RGB',(8,4),(255,0,0)).save(sys.argv[2])`,
        mono,
        color
    ]);
    const page = await application.firstWindow();
    const scenario = await createScenario(application, page, profile);
    await chooseFile(application, mono);
    await clickRibbon(page, "Add Image");
    const source = page.getByRole("article", {
        name: "intensity.tif",
        exact: true
    });
    await expect(
        source.getByRole("img", { name: "intensity.tif", exact: true })
    ).toBeVisible();
    await clickRibbon(page, "Metadata");
    await expect(
        source.getByRole("complementary", { name: "Image metadata" })
    ).toContainText("TIFF");
    await clickRibbon(page, "Pixel Values");
    const bounds = (await source.locator(".slice-viewport").boundingBox())!;
    const scale = Math.min(bounds.width / 8, bounds.height / 4);
    await page.mouse.move(
        bounds.x + (bounds.width - 8 * scale) / 2 + 3.5 * scale,
        bounds.y + (bounds.height - 4 * scale) / 2 + 2.5 * scale
    );
    await expect(source.getByRole("status")).toContainText(
        "Source intensity: 19000"
    );
    await chooseFile(application, color);
    await clickRibbon(page, "Add Image");
    const colorImage = page
        .getByRole("article", { name: "color.tiff", exact: true })
        .getByRole("img", { name: "color.tiff", exact: true });
    await expect(colorImage).toBeVisible();
    expect(
        await colorImage.evaluate(async node => {
            const image = node as HTMLImageElement;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
        })
    ).toEqual([255, 0, 0, 255]);
    await clickRibbon(page, "Close");
    await chooseFile(application, scenario);
    await clickRibbon(page, "Open");
    await expect(colorImage).toBeVisible();
    await expect(
        source.getByRole("img", { name: "intensity.tif", exact: true })
    ).toBeVisible();
});
