// @vitest-environment jsdom
import { test, expect, afterEach, vi } from "vitest";
import {
    defaultPercentiles,
    selectedPercentiles,
    validatePercentiles,
    savePercentiles,
    visibleStatistics
} from "../../src/composables/useSettings";

afterEach(() => {
    localStorage.clear();
    selectedPercentiles.value = [...defaultPercentiles];
    vi.restoreAllMocks();
});

test("validates percentile ranges and sorts unique selections", () => {
    expect(validatePercentiles([100, 0, 50, 50])).toEqual([0, 50, 100]);

    for (const invalid of [
        [],
        null,
        [NaN],
        [101],
        [-1],
        [1.5],
        ["50"],
        Array(102).fill(1)
    ]) {
        expect(() => validatePercentiles(invalid)).toThrow(/0 to 100/);
    }
});

test("saves preferences and filters percentile fields reactively", () => {
    savePercentiles([90, 25, 90]);
    expect(selectedPercentiles.value).toEqual([25, 90]);
    expect(localStorage.getItem("nova.settings.percentiles")).toBe("[25,90]");
    expect(
        visibleStatistics({
            "25th percentile": 2,
            "50th percentile": 3,
            "90th percentile": 5,
            Other: true
        })
    ).toEqual({ "25th percentile": 2, "90th percentile": 5, Other: true });
});

test("storage failure does not change active preferences", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
    });
    expect(() => savePercentiles([10, 90])).toThrow(/Storage unavailable/);
    expect(selectedPercentiles.value).toEqual(defaultPercentiles);
});

test("reloads saved settings and falls back safely for corrupt storage", async () => {
    localStorage.setItem("nova.settings.percentiles", "[10,90]");
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).selectedPercentiles
            .value
    ).toEqual([10, 90]);
    localStorage.setItem("nova.settings.percentiles", "bad json");
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).selectedPercentiles
            .value
    ).toEqual(defaultPercentiles);
});

test("validates and persists image formation settings", async () => {
    const { validateFormationSettings, defaultFormationSettings } =
        await import("../../src/types/formation");
    const { saveFormationSettings, formationSettings } =
        await import("../../src/composables/useSettings");

    for (const patch of [
        { imageSize: 0 },
        { pixelSpacing: NaN },
        { maxVectors: 1 },
        { maxVectors: 8.5 },
        { window: "bad" },
        { algorithm: "pfa" }
    ]) {
        expect(() =>
            validateFormationSettings({ ...defaultFormationSettings, ...patch })
        ).toThrow();
    }

    saveFormationSettings({
        ...defaultFormationSettings,
        imageSize: 128,
        window: "uniform"
    });
    expect(formationSettings.value.imageSize).toBe(128);
    expect(
        JSON.parse(localStorage.getItem("nova.settings.formation")!).window
    ).toBe("uniform");
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).formationSettings
            .value.imageSize
    ).toBe(128);
    localStorage.setItem("nova.settings.formation", "{}");
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).formationSettings
            .value
    ).toEqual(defaultFormationSettings);
});

test("SIDD settings validate, persist, and recover from invalid storage", async () => {
    const { validateSiddSettings, defaultSiddSettings } =
        await import("../../src/types/sidd");

    for (const patch of [
        { version: 1 },
        { bitDepth: 32 },
        { contrast: "bad" },
        { interpolation: "bad" },
        { pixelSpacing: NaN },
        { pixelSpacing: -1 }
    ]) {
        expect(() =>
            validateSiddSettings({ ...defaultSiddSettings, ...patch })
        ).toThrow();
    }

    const { saveSiddSettings, siddSettings } =
        await import("../../src/composables/useSettings");

    saveSiddSettings({ ...defaultSiddSettings, bitDepth: 16, version: 2 });
    expect(siddSettings.value.bitDepth).toBe(16);
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).siddSettings.value
            .version
    ).toBe(2);
    localStorage.setItem("nova.settings.sidd", "{}");
    vi.resetModules();
    expect(
        (await import("../../src/composables/useSettings")).siddSettings.value
    ).toEqual(defaultSiddSettings);
});
