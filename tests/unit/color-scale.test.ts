import { test, expect } from "vitest";
import { validateColorScale } from "../../src/types/color-scale";
import { paletteColor, colorizePixels } from "../../src/utils/color-scale";
import { validateWorkspace } from "../../src/types/workspace";

const scale = { minimum: 64, maximum: 192, colors: ["#0000ff", "#ff0000"] };

test("validates and detaches clipping limits and palette stops", () => {
    const result = validateColorScale(scale);

    expect(result).toEqual(scale);
    expect(result.colors).not.toBe(scale.colors);
    expect(
        validateColorScale({ ...scale, minimum: null, maximum: null })
    ).toMatchObject({ minimum: null, maximum: null });
    for (const value of [
        null,
        {},
        { ...scale, minimum: NaN },
        { ...scale, maximum: Infinity },
        { ...scale, minimum: 192 },
        { ...scale, colors: ["red", "blue"] },
        { ...scale, colors: ["#000000"] }
    ]) {
        expect(() => validateColorScale(value)).toThrow();
    }
});

test("clips and interpolates colors without changing alpha", () => {
    expect(paletteColor(scale.colors, -1)).toEqual([0, 0, 255]);
    expect(paletteColor(scale.colors, 0.5)).toEqual([128, 0, 128]);
    expect(paletteColor(scale.colors, 2)).toEqual([255, 0, 0]);
    const pixels = new Uint8ClampedArray([
        0, 0, 0, 0, 128, 128, 128, 128, 255, 255, 255, 255
    ]);

    colorizePixels(pixels, scale);
    expect([...pixels]).toEqual([
        0, 0, 255, 0, 128, 0, 128, 128, 255, 0, 0, 255
    ]);
    expect(() =>
        colorizePixels(pixels, { ...scale, minimum: 300, maximum: null })
    ).toThrow();
});

test("validates color mappings in saved scenarios", () => {
    const window = {
        id: 1,
        path: "/image.png",
        pluginId: "test",
        rect: { x: 0, y: 0, width: 300, height: 200 },
        minimized: false,
        maximized: false,
        z: 0,
        colorScale: scale
    };

    expect(validateWorkspace([window])[0]?.colorScale).toEqual(scale);
    expect(() =>
        validateWorkspace([{ ...window, colorScale: { ...scale, maximum: 0 } }])
    ).toThrow();
});
