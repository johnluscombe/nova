import { test, expect } from "vitest";
import { validateRibbon } from "../../src/types/ribbon.ts";
import { validateWorkspace } from "../../src/types/workspace.ts";

const button = {
    id: "inspect",
    label: "Inspect",
    icon: "info",
    requiresScenario: true
};
const group = { id: "tools", label: "Tools", buttons: [button] };
const tab = { id: "home", label: "Home", groups: [group] };

test("ribbon validation accepts valid contributions and rejects malformed tabs and groups", () => {
    expect(validateRibbon({ tabs: [tab] }).tabs).toEqual([tab]);

    for (const value of [
        null,
        {},
        { tabs: Array(21).fill(tab) },
        { tabs: [tab, tab] },
        { tabs: [{ ...tab, id: "Bad ID" }] },
        { tabs: [{ ...tab, label: " " }] },
        { tabs: [{ ...tab, groups: [group, group] }] },
        { tabs: [{ ...tab, groups: [{ ...group, buttons: null }] }] }
    ]) {
        expect(() => validateRibbon(value)).toThrow();
    }
});

test("ribbon action IDs are unique across tabs and controls have bounded plain labels", () => {
    for (const invalid of [
        null,
        { ...button, id: "1bad" },
        { ...button, label: "x".repeat(101) },
        { ...button, icon: "https://icon" },
        { ...button, requiresScenario: "true" }
    ]) {
        expect(() =>
            validateRibbon({
                tabs: [{ ...tab, groups: [{ ...group, buttons: [invalid] }] }]
            })
        ).toThrow(/button/);
    }

    expect(() =>
        validateRibbon({ tabs: [tab, { ...tab, id: "other" }] })
    ).toThrow(/button/);
});

const window = {
    id: 1,
    path: "/image.png",
    pluginId: "nova.raster",
    rect: { x: 0, y: 0, width: 520, height: 360 },
    minimized: false,
    maximized: false,
    z: 1
};

test("workspace validation rejects oversized layouts, duplicate IDs and invalid geometry", () => {
    expect(validateWorkspace([window])).toEqual([window]);
    expect(
        validateWorkspace([
            {
                ...window,
                metadataFiles: ["/axes.json"],
                metadataAxesSource: "/axes.json"
            }
        ])[0]?.metadataAxesSource
    ).toBe("/axes.json");
    expect(
        validateWorkspace([{ ...window, scaling: "real" }])[0]?.scaling
    ).toBe("real");

    for (const value of [
        null,
        {},
        Array(1001).fill(window),
        [window, window],
        [null],
        [{ ...window, id: 0 }],
        [
            {
                ...window,
                region: [
                    { row: 0, column: 0 },
                    { row: 1, column: 1 }
                ]
            }
        ],
        [{ ...window, metadataFiles: [false] }],
        [{ ...window, metadataAxesSource: "/missing.json" }],
        [{ ...window, scaling: "invalid" }],
        [{ ...window, path: "" }],
        [{ ...window, pluginId: "" }],
        [{ ...window, minimized: 1 }],
        [{ ...window, maximized: null }],
        [{ ...window, z: -1 }],
        [{ ...window, rect: { ...window.rect, width: 0 } }],
        [{ ...window, rect: { ...window.rect, x: -1 } }],
        [{ ...window, rect: { ...window.rect, height: Infinity } }]
    ]) {
        expect(() => validateWorkspace(value)).toThrow();
    }
});
