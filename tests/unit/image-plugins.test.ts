import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImagePlugins } from "../../src-electron/image-plugins.ts";

async function fixture(
    run: (directory: string, host: ImagePlugins) => Promise<void>
) {
    const directory = await mkdtemp(path.join(tmpdir(), "nova-plugin-test-"));
    try {
        await run(directory, new ImagePlugins(directory));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function plugin(
    directory: string,
    name: string,
    code: string,
    overrides: Record<string, unknown> = {}
) {
    const folder = path.join(directory, name);
    await mkdir(folder);
    await writeFile(
        path.join(folder, "plugin.json"),
        JSON.stringify({
            apiVersion: 1,
            id: name,
            name,
            main: "index.ts",
            extensions: ["test"],
            ...overrides
        })
    );
    await writeFile(path.join(folder, "index.ts"), code);
}

test("no plugins means no supported filters or image opening", () =>
    fixture(async (directory, host) => {
        const state = await host.reload();
        assert.equal(state.directory, directory);
        assert.deepEqual(state.plugins, []);
        assert.deepEqual(host.filters, []);
        await assert.rejects(
            host.open("missing.png"),
            /Install an image plugin/
        );
    }));

test("discovers plugins, isolates failures, invokes plugin-owned file I/O, and reloads additions", () =>
    fixture(async (directory, host) => {
        await host.reload();
        await plugin(directory, "a-broken", "export default {};");
        await plugin(
            directory,
            "b-version",
            "export default { open() { return {}; } };",
            { apiVersion: 99 }
        );
        await plugin(
            directory,
            "c-working",
            `import {readFile} from 'node:fs/promises'; export default { async open(file) { return {width: Number(await readFile(file, 'utf8')), height: 2}; } };`
        );
        const state = await host.reload();
        assert.equal(state.plugins.length, 1);
        assert.equal(state.errors.length, 2);
        assert.deepEqual(host.filters[0]!.extensions, ["test"]);
        const file = path.join(directory, "image.TEST");
        await writeFile(file, "8");
        assert.deepEqual(await host.open(file), {
            name: "image.TEST",
            path: file,
            pluginId: "c-working",
            pluginName: "c-working",
            width: 8,
            height: 2
        });
        await assert.rejects(
            host.open("unknown.png"),
            /No installed image plugin/
        );
        await rm(path.join(directory, "c-working"), { recursive: true });
        assert.equal((await host.reload()).plugins.length, 0);
    }));

test("tries subsequent matching decoders after decline, failure, or invalid output", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "a-decline",
            "export default {canOpen() { return false; }, open() { throw new Error('should not run'); }};"
        );
        await plugin(
            directory,
            "b-fail",
            "export default {open() { throw new Error('bad decode'); }};"
        );
        await plugin(
            directory,
            "c-invalid",
            "export default {open() { return {previewDataUrl: 'javascript:alert(1)'}; }};"
        );
        await plugin(
            directory,
            "d-ok",
            "export default {open() { return {width: 3, height: 4}; }};"
        );
        await host.reload();
        assert.equal((await host.open("file.test")).pluginId, "d-ok");
        await rm(path.join(directory, "d-ok"), { recursive: true });
        await host.reload();
        await assert.rejects(host.open("file.test"), /bad decode/);
    }));

test("rejects escaping entry paths and duplicate IDs", () =>
    fixture(async (directory, host) => {
        await writeFile(
            path.join(directory, "outside.ts"),
            "export default {open() {return {};}};"
        );
        await plugin(directory, "a-escape", "", { main: "../outside.ts" });
        await plugin(
            directory,
            "b-first",
            "export default {open() {return {};}};",
            { id: "shared" }
        );
        await plugin(
            directory,
            "c-duplicate",
            "export default {open() {return {};}};",
            { id: "shared" }
        );
        const state = await host.reload();
        assert.equal(state.plugins.length, 1);
        assert.equal(state.errors.length, 2);
    }));

test("bundled plugins load without user installation and user overrides take priority", () =>
    fixture(async directory => {
        const bundled = path.join(directory, "bundled");
        const user = path.join(directory, "user");
        await mkdir(bundled);
        await mkdir(user);
        await plugin(
            bundled,
            "default",
            "export default {open() {return {width: 10};}};",
            { id: "shared" }
        );
        const host = new ImagePlugins(user, bundled);
        assert.equal((await host.reload()).plugins.length, 1);
        assert.equal((await host.open("file.test")).width, 10);
        await plugin(
            user,
            "override",
            "export default {open() {return {width: 20};}};",
            { id: "shared" }
        );
        assert.equal((await host.reload()).plugins.length, 1);
        assert.equal((await host.open("file.test")).width, 20);
        await rm(path.join(user, "override"), { recursive: true });
        await plugin(user, "broken", "export default {};", { id: "shared" });
        const state = await host.reload();
        assert.equal(state.plugins.length, 1);
        assert.equal(state.errors.length, 1);
        assert.equal((await host.open("file.test")).width, 10);
    }));

test("vector plugin reads SVG and host accepts a vector preview", () =>
    fixture(async directory => {
        const { default: vector } =
            await import("../../src-electron/electron-assets/plugins/vector/index.ts");
        const file = path.join(directory, "sample.svg");
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/></svg>';
        await writeFile(file, svg);
        const result = await vector.open(file);
        assert.equal(
            Buffer.from(
                result.previewDataUrl!.split(",")[1]!,
                "base64"
            ).toString(),
            svg
        );
        await plugin(
            directory,
            "vector",
            `export default {open() {return ${JSON.stringify(result)};}};`,
            { extensions: ["svg"] }
        );
        const host = new ImagePlugins(directory);
        await host.reload();
        assert.equal(
            (await host.open(file)).previewDataUrl,
            result.previewDataUrl
        );
        await writeFile(file, "not an SVG");
        await assert.rejects(vector.open(file), /does not contain an SVG/);
    }));

test("ribbon-only plugins contribute controls and dispatch only declared actions", () =>
    fixture(async (directory, host) => {
        const ribbon = {
            tabs: [
                {
                    id: "tools",
                    label: "Tools",
                    groups: [
                        {
                            id: "inspect",
                            label: "Inspect",
                            buttons: [
                                {
                                    id: "run",
                                    label: "Run",
                                    icon: "info",
                                    requiresScenario: true
                                }
                            ]
                        }
                    ]
                }
            ]
        };
        await plugin(
            directory,
            "ribbon",
            `export default {executeRibbonAction(id, context, parameters) {if (parameters.python !== '/custom/python') throw new Error('Missing parameters'); return {message: id + ':' + context.scenarioPath};}};`,
            { extensions: [], ribbon, parameters: { python: "/custom/python" } }
        );
        const state = await host.reload();
        assert.equal(state.errors.length, 0);
        assert.deepEqual(state.plugins[0]!.ribbon, ribbon);
        assert.deepEqual(host.filters, []);
        await assert.rejects(
            host.executeRibbonAction("ribbon", "run", { scenarioPath: null }),
            /Open a scenario/
        );
        assert.deepEqual(
            await host.executeRibbonAction("ribbon", "run", {
                scenarioPath: "/test.scenario"
            }),
            { message: "run:/test.scenario" }
        );
        await assert.rejects(
            host.executeRibbonAction("ribbon", "unknown", {
                scenarioPath: null
            }),
            /Unknown plugin/
        );
        await assert.rejects(
            host.executeRibbonAction("missing", "run", { scenarioPath: null }),
            /Unknown plugin/
        );
    }));

test("invalid ribbon declarations and missing action handlers are isolated", () =>
    fixture(async (directory, host) => {
        const button = { id: "run", label: "Run" };
        const ribbon = {
            tabs: [
                {
                    id: "home",
                    label: "Home",
                    groups: [{ id: "image", label: "Image", buttons: [button] }]
                }
            ]
        };
        await plugin(directory, "missing-handler", "export default {};", {
            extensions: [],
            ribbon
        });
        await plugin(
            directory,
            "duplicate",
            "export default {executeRibbonAction() {}};",
            {
                extensions: [],
                ribbon: {
                    tabs: [
                        {
                            ...ribbon.tabs[0],
                            groups: [
                                {
                                    ...ribbon.tabs[0]!.groups[0],
                                    buttons: [button, button]
                                }
                            ]
                        }
                    ]
                }
            }
        );
        await plugin(
            directory,
            "bad-icon",
            "export default {executeRibbonAction() {}};",
            {
                extensions: [],
                ribbon: {
                    tabs: [
                        {
                            ...ribbon.tabs[0],
                            groups: [
                                {
                                    ...ribbon.tabs[0]!.groups[0],
                                    buttons: [
                                        {
                                            ...button,
                                            icon: "img:https://example.com/icon.png"
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            }
        );
        const state = await host.reload();
        assert.equal(state.plugins.length, 0);
        assert.equal(state.errors.length, 3);
    }));

test("plugin action exceptions and invalid results are reported", () =>
    fixture(async (directory, host) => {
        const ribbon = {
            tabs: [
                {
                    id: "home",
                    label: "Home",
                    groups: [
                        {
                            id: "image",
                            label: "Image",
                            buttons: [
                                { id: "fail", label: "Fail" },
                                { id: "invalid", label: "Invalid" }
                            ]
                        }
                    ]
                }
            ]
        };
        await plugin(
            directory,
            "actions",
            "export default {executeRibbonAction(id) {if (id === 'fail') {throw new Error('action failed');} return {message: 42};}};",
            { extensions: [], ribbon, parameters: { python: "/custom/python" } }
        );
        await host.reload();
        await assert.rejects(
            host.executeRibbonAction("actions", "fail", { scenarioPath: null }),
            /action failed/
        );
        await assert.rejects(
            host.executeRibbonAction("actions", "invalid", {
                scenarioPath: null
            }),
            /Invalid plugin action result/
        );
    }));

test("passes plugin parameters to image handlers and rejects malformed parameters", () =>
    fixture(async directory => {
        await plugin(
            directory,
            "configured",
            `export default {
            canOpen(file, parameters) {
                if (parameters.python !== '/custom/python' || !Object.isFrozen(parameters)) throw new Error('Missing parameters');
                return true;
            },
            open(file, parameters) { return { width: parameters.size }; }
        };`,
            {
                parameters: {
                    python: "/custom/python",
                    size: 42,
                    enabled: true,
                    optional: null
                }
            }
        );
        const host = new ImagePlugins(directory);
        assert.equal((await host.reload()).plugins.length, 1);
        assert.equal((await host.open("file.test")).width, 42);
        for (const [index, parameters] of [
            [],
            null,
            "python",
            { nested: {} }
        ].entries()) {
            await plugin(
                directory,
                `invalid-${index}`,
                "export default { open() { return {}; } };",
                { parameters }
            );
            const state = await host.reload();
            assert.equal(state.plugins.length, 1);
            assert.match(state.errors.join(), /Plugin parameters/);
        }
    }));

test("preserves scalar metadata and rejects invalid plugin metadata", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "metadata",
            `export default { open() { return { metadata: { Collector: 'Example', Spacing: 1.5, Calibrated: false, Missing: null } }; } };`
        );
        await host.reload();
        assert.deepEqual((await host.open("file.test")).metadata, {
            Collector: "Example",
            Spacing: 1.5,
            Calibrated: false,
            Missing: null
        });
        await plugin(
            directory,
            "invalid-metadata",
            `export default { open() { return { metadata: { nested: {} } }; } };`
        );
        await host.reload();
        await assert.rejects(
            host.open("file.test", "invalid-metadata"),
            /Invalid image metadata/
        );
    }));

test("preserves statistics and rejects nested statistics", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "stats",
            `export default { open() { return { statistics: { Mean: 2, Basis: 'Sampled amplitude' } }; } };`
        );
        await host.reload();
        assert.deepEqual((await host.open("file.test")).statistics, {
            Mean: 2,
            Basis: "Sampled amplitude"
        });
        await plugin(
            directory,
            "bad-stats",
            `export default { open() { return { statistics: { Mean: [] } }; } };`
        );
        await host.reload();
        await assert.rejects(
            host.open("file.test", "bad-stats"),
            /Invalid image statistics/
        );
    }));

test("rejects malformed dimensions and previews rather than passing them to the renderer", () =>
    fixture(async (directory, host) => {
        const results = [
            "null",
            "{ width: 0 }",
            "{ height: 1.5 }",
            "{ previewDataUrl: 'javascript:alert(1)' }",
            "{ metadata: { bad: Infinity } }",
            "{ statistics: { bad: [] } }"
        ];
        for (const [index, result] of results.entries()) {
            await plugin(
                directory,
                `bad-${index}`,
                `export default { open() { return ${result}; } };`
            );
        }
        await host.reload();
        for (let index = 0; index < 6; index++) {
            await assert.rejects(
                host.open("file.test", `bad-${index}`),
                /Invalid|Preview must/
            );
        }
    }));

test("ignores loose files, rejects plugins with no contribution, and permits silent actions", () =>
    fixture(async (directory, host) => {
        await writeFile(path.join(directory, "README.txt"), "not a plugin");
        await plugin(directory, "empty", "export default {};", {
            extensions: []
        });
        const ribbon = {
            tabs: [
                {
                    id: "home",
                    label: "Home",
                    groups: [
                        {
                            id: "tools",
                            label: "Tools",
                            buttons: [{ id: "run", label: "Run" }]
                        }
                    ]
                }
            ]
        };
        await plugin(
            directory,
            "silent",
            "export default { executeRibbonAction() {} };",
            { extensions: [], ribbon }
        );
        const status = await host.reload();
        assert.match(
            status.errors.join(),
            /must provide image types or ribbon tabs/
        );
        assert.deepEqual(
            await host.executeRibbonAction("silent", "run", {
                scenarioPath: null
            }),
            {}
        );
    }));

test("source slices validate the opened image, orientation, index and returned samples", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "slices",
            `export default {
            open() { return { width: 4, height: 3 }; },
            readSlice(file, orientation, index) {
                if (index === 2) return { positionLabel: 'Column', valueLabel: 'Amplitude', points: [{ position: 0, value: Infinity }] };
                return { positionLabel: 'Column', valueLabel: 'Amplitude', points: [{ position: 0, value: 5 }, { position: 3, value: null }] };
            }
        };`
        );
        await host.reload();
        await assert.rejects(
            host.readSlice("file.test", "slices", "horizontal", 0),
            /Open an image/
        );
        assert.equal((await host.open("file.test")).supportsSourceSlices, true);
        assert.deepEqual(
            (await host.readSlice("file.test", "slices", "horizontal", 1))
                .points,
            [
                { position: 0, value: 5 },
                { position: 3, value: null }
            ]
        );
        for (const index of [-1, 0.5, 3]) {
            await assert.rejects(
                host.readSlice("file.test", "slices", "horizontal", index),
                /outside/
            );
        }
        await assert.rejects(
            host.readSlice("file.test", "slices", "diagonal" as never, 0),
            /outside/
        );
        await assert.rejects(
            host.readSlice("file.test", "slices", "horizontal", 2),
            /invalid slice data/
        );
    }));

test("scaling is restricted to opened images and their advertised modes", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "scaling",
            `export default {
            open(file, parameters, scaling = 'amplitude') {
                return { width: 4, height: 3, scaling, scalingOptions: ['amplitude', 'real'], metadata: { Scaling: scaling } };
            },
            readSlice(file, orientation, index, parameters, scaling = 'amplitude') {
                return { points: [{position: 0, value: scaling === 'real' ? -3 : 5}], positionLabel: 'Column', valueLabel: scaling };
            }
        };`
        );
        await host.reload();
        await assert.rejects(
            host.rescale("file.test", "scaling", "real"),
            /unavailable/
        );
        await host.open("file.test");
        const image = await host.rescale("file.test", "scaling", "real");
        assert.equal(image.scaling, "real");
        assert.equal(image.metadata?.Scaling, "real");
        const slice = await host.readSlice(
            "file.test",
            "scaling",
            "horizontal",
            1,
            "real"
        );
        assert.equal(slice.points[0]?.value, -3);
        await assert.rejects(
            host.rescale("file.test", "scaling", "rcs"),
            /unavailable/
        );
        await assert.rejects(
            host.readSlice("file.test", "scaling", "horizontal", 1, "rcs"),
            /unavailable/
        );
    }));

test("invalid scaling capabilities are rejected", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "scaling",
            `export default {
            open() { return { scaling: 'unknown', scalingOptions: ['unknown'] }; }
        };`
        );
        await host.reload();
        await assert.rejects(
            host.open("file.test"),
            /Invalid image scaling options/
        );
    }));

test("source pixel reads validate coordinates, capabilities, scaling and numeric results", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "pixels",
            `export default {
            open() { return {width: 8, height: 4, scaling: 'amplitude', scalingOptions: ['amplitude', 'relative-power'], peakPower: 100}; },
            readPixel(file, row, column, parameters, scaling, peakPower) {
                if (column === 6) return {value: Infinity, valueLabel: 'bad'};
                if (column === 7) return {value: null, valueLabel: 'Source amplitude'};
                return {value: scaling === 'relative-power' ? peakPower : row * 8 + column, valueLabel: 'Source amplitude'};
            }
        };`
        );
        await host.reload();
        await assert.rejects(
            host.readPixel("file.test", "pixels", 0, 0),
            /Open an image/
        );
        assert.equal((await host.open("file.test")).supportsSourcePixels, true);
        assert.equal(
            (await host.readPixel("file.test", "pixels", 2, 3)).value,
            19
        );
        assert.equal(
            (
                await host.readPixel(
                    "file.test",
                    "pixels",
                    0,
                    0,
                    "relative-power"
                )
            ).value,
            100
        );
        assert.equal(
            (await host.readPixel("file.test", "pixels", 0, 7)).value,
            null
        );
        for (const [row, column] of [
            [-1, 0],
            [0, -1],
            [4, 0],
            [0, 8],
            [0.5, 1],
            [NaN, 0]
        ]) {
            await assert.rejects(
                host.readPixel("file.test", "pixels", row!, column!),
                /outside/
            );
        }
        await assert.rejects(
            host.readPixel("file.test", "pixels", 0, 0, "rcs"),
            /unavailable/
        );
        await assert.rejects(
            host.readPixel("file.test", "pixels", 0, 6),
            /invalid pixel data/
        );
    }));

test("plugin axes preserve physical coordinates and reject invalid metadata", () =>
    fixture(async (directory, host) => {
        await plugin(
            directory,
            "axes",
            `export default {
            open(file) {
                return {width: 8, height: 4, axes: {
                    row: {label: 'Down-range', unit: 'm', origin: -4, spacing: 2},
                    column: {label: 'Cross-range', unit: 'm', origin: -2, spacing: file.includes('invalid') ? 0 : 0.5}
                }};
            }
        };`
        );
        await host.reload();
        const image = await host.open("file.test");
        assert.deepEqual(image.axes?.column, {
            label: "Cross-range",
            unit: "m",
            origin: -2,
            spacing: 0.5
        });
        await assert.rejects(host.open("invalid.test"), /Invalid image axes/);
    }));
