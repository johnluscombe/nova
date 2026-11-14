import { test } from "vitest";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { openSicd } from "../../src-electron/electron-assets/plugins/sicd/index.ts";

test("SICD uses an argument array and returns the worker preview", async () => {
    const result = {
        width: 4096,
        height: 2048,
        previewDataUrl: "data:image/png;base64,eA=="
    };
    const file = '/images/scene "special" $(name).nitf';
    const actual = await openSicd(
        file,
        { python: "/custom Python/bin/python" },
        async (_python, args, options) => {
            assert.equal(_python, "/custom Python/bin/python");
            assert.equal(args[1], file);
            assert.ok(args[0]!.endsWith("reader.py"));
            assert.equal(options.timeout, 120000);
            assert.equal(options.windowsHide, true);
            assert.equal(options.shell, undefined);
            return { stdout: JSON.stringify(result) };
        }
    );
    assert.deepEqual(actual, result);
});
test("SICD reports setup, timeout, decoding, and protocol failures", async () => {
    await assert.rejects(
        openSicd("file.nitf", {}, async () => {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }),
        /could not find Python interpreter/
    );
    await assert.rejects(
        openSicd("file.nitf", {}, async () => {
            throw Object.assign(new Error("timeout"), { killed: true });
        }),
        /time limit/
    );
    await assert.rejects(
        openSicd("file.nitf", {}, async () => {
            throw Object.assign(new Error("exit 1"), {
                stderr: "Invalid SICD metadata"
            });
        }),
        /Invalid SICD metadata/
    );
    await assert.rejects(
        openSicd("file.nitf", {}, async () => ({ stdout: "bad JSON" })),
        /invalid output/
    );
    await assert.rejects(
        openSicd("file.nitf", {}, async () => ({ stdout: '{"width":-1}' })),
        /invalid preview/
    );
});

test("SICD expands a home-relative interpreter without a shell", async () => {
    await openSicd(
        "file.nitf",
        { python: "~/.nova/bin/python3" },
        async (python, _args, options) => {
            assert.equal(python, path.join(homedir(), ".nova/bin/python3"));
            assert.equal(options.shell, undefined);
            return {
                stdout: JSON.stringify({
                    width: 1,
                    height: 1,
                    previewDataUrl: "data:image/png;base64,eA=="
                })
            };
        }
    );
    await assert.rejects(
        openSicd("file.nitf", { python: "/missing/python" }, async () => {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }),
        /"\/missing\/python"/
    );
    await assert.rejects(
        openSicd("file.nitf", { python: "/restricted/python" }, async () => {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
        }),
        /permission denied/
    );
});

test("SICD rejects invalid interpreter parameters", async () => {
    for (const python of ["", "   ", 42, false]) {
        await assert.rejects(
            openSicd("file.nitf", { python }, async () => {
                assert.fail("Invalid interpreter must not execute");
            }),
            /python parameter/
        );
    }
});

test("default SICD export forwards configured interpreter parameters", async () => {
    const plugin = (
        await import("../../src-electron/electron-assets/plugins/sicd/index.ts")
    ).default;
    await assert.rejects(
        plugin.open("missing.nitf", { python: "" }),
        /python parameter/
    );
});

test("SICD source slices pass orientation and index to the Python worker", async () => {
    const { readSicdSlice } =
        await import("../../src-electron/electron-assets/plugins/sicd/index.ts");
    const expected = {
        points: [{ position: 0, value: 5 }],
        positionLabel: "Column (pixel)",
        valueLabel: "Source amplitude"
    };
    const result = await readSicdSlice(
        "image.nitf",
        "horizontal",
        7,
        { python: "/venv/python" },
        async (python, args) => {
            assert.equal(python, "/venv/python");
            assert.deepEqual(args.slice(1), [
                "image.nitf",
                "--slice",
                "horizontal",
                "7"
            ]);
            return { stdout: JSON.stringify(expected) };
        }
    );
    assert.deepEqual(result, expected);
});

test("SICD forwards scaling for previews and source slices", async () => {
    const { readSicdSlice } =
        await import("../../src-electron/electron-assets/plugins/sicd/index.ts");
    await openSicd(
        "image.nitf",
        {},
        async (_python, args) => {
            assert.deepEqual(args.slice(1), [
                "image.nitf",
                "--scaling",
                "real"
            ]);
            return {
                stdout: JSON.stringify({
                    width: 1,
                    height: 1,
                    previewDataUrl: "data:image/png;base64,eA==",
                    scaling: "real",
                    scalingOptions: ["amplitude", "real"]
                })
            };
        },
        "real"
    );
    const expected = {
        points: [{ position: 0, value: -3 }],
        positionLabel: "Column",
        valueLabel: "Real component"
    };
    assert.deepEqual(
        await readSicdSlice(
            "image.nitf",
            "horizontal",
            0,
            {},
            async (_python, args) => {
                assert.deepEqual(args.slice(1), [
                    "image.nitf",
                    "--slice",
                    "horizontal",
                    "0",
                    "real"
                ]);
                return { stdout: JSON.stringify(expected) };
            },
            "real"
        ),
        expected
    );
});

test("SICD pixel requests forward exact coordinates, scaling and the preview power reference", async () => {
    const { readSicdPixel } =
        await import("../../src-electron/electron-assets/plugins/sicd/index.ts");
    const expected = {
        value: -6.0206,
        valueLabel: "Relative power (dB, sampled peak = 0)"
    };
    assert.deepEqual(
        await readSicdPixel(
            "image.nitf",
            2,
            7,
            {},
            async (_python, args) => {
                assert.deepEqual(args.slice(1), [
                    "image.nitf",
                    "--pixel",
                    "2",
                    "7",
                    "relative-power",
                    "100"
                ]);
                return { stdout: JSON.stringify(expected) };
            },
            "relative-power",
            100
        ),
        expected
    );
});
