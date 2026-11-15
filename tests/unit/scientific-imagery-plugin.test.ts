import { test } from "vitest";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { openScientificImage } from "../../src-electron/electron-assets/plugins/scientific-imagery/index.ts";

test("Scientific Imagery uses an argument array and returns the worker preview", async () => {
    const result = {
        width: 4096,
        height: 2048,
        previewDataUrl: "data:image/png;base64,eA=="
    };
    const file = '/images/scene "special" $(name).nitf';
    const actual = await openScientificImage(
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
test("Scientific Imagery reports setup, timeout, decoding, and protocol failures", async () => {
    await assert.rejects(
        openScientificImage("file.nitf", {}, async () => {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }),
        /could not find Python interpreter/
    );
    await assert.rejects(
        openScientificImage("file.nitf", {}, async () => {
            throw Object.assign(new Error("timeout"), { killed: true });
        }),
        /time limit/
    );
    await assert.rejects(
        openScientificImage("file.nitf", {}, async () => {
            throw Object.assign(new Error("exit 1"), {
                stderr: "Invalid SICD metadata"
            });
        }),
        /Invalid SICD metadata/
    );
    await assert.rejects(
        openScientificImage("file.nitf", {}, async () => ({
            stdout: "bad JSON"
        })),
        /invalid output/
    );
    await assert.rejects(
        openScientificImage("file.nitf", {}, async () => ({
            stdout: '{"width":-1}'
        })),
        /invalid preview/
    );
});

test("Scientific Imagery expands a home-relative interpreter without a shell", async () => {
    await openScientificImage(
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
        openScientificImage(
            "file.nitf",
            { python: "/missing/python" },
            async () => {
                throw Object.assign(new Error("not found"), { code: "ENOENT" });
            }
        ),
        /"\/missing\/python"/
    );
    await assert.rejects(
        openScientificImage(
            "file.nitf",
            { python: "/restricted/python" },
            async () => {
                throw Object.assign(new Error("denied"), { code: "EACCES" });
            }
        ),
        /permission denied/
    );
});

test("Scientific Imagery rejects invalid interpreter parameters", async () => {
    for (const python of ["", "   ", 42, false]) {
        await assert.rejects(
            openScientificImage("file.nitf", { python }, async () => {
                assert.fail("Invalid interpreter must not execute");
            }),
            /python parameter/
        );
    }
});

test("default Scientific Imagery export forwards configured interpreter parameters", async () => {
    const plugin = (
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts")
    ).default;

    await assert.rejects(
        plugin.open("missing.nitf", { python: "" }),
        /python parameter/
    );
});

test("Scientific Imagery source slices pass orientation and index to the Python worker", async () => {
    const { readImageSlice } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");
    const expected = {
        points: [{ position: 0, value: 5 }],
        positionLabel: "Column (pixel)",
        valueLabel: "Source amplitude"
    };
    const result = await readImageSlice(
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

test("Scientific Imagery forwards scaling for previews and source slices", async () => {
    const { readImageSlice } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");

    await openScientificImage(
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
        await readImageSlice(
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

test("Scientific Imagery pixel requests forward exact coordinates, scaling and the preview power reference", async () => {
    const { readImagePixel } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");
    const expected = {
        value: -6.0206,
        valueLabel: "Relative power (dB, sampled peak = 0)"
    };

    assert.deepEqual(
        await readImagePixel(
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

test("Scientific Imagery forwards and validates the TIFF pixel limit", async () => {
    for (const limit of [0, 1000000000, 2000000000]) {
        await openScientificImage(
            "large.tif",
            { maxTiffPixels: limit },
            async (_python, args) => {
                assert.deepEqual(args.slice(-2), [
                    "--max-tiff-pixels",
                    String(limit)
                ]);

                return {
                    stdout: JSON.stringify({
                        width: 1,
                        height: 1,
                        previewDataUrl: "data:image/png;base64,eA=="
                    })
                };
            }
        );
    }

    for (const maxTiffPixels of [-1, 1.5, "1000", true, null, Infinity]) {
        await assert.rejects(
            openScientificImage("large.tif", { maxTiffPixels }, async () => {
                assert.fail("Invalid limit must not execute");
            }),
            /maxTiffPixels parameter/
        );
    }
});

test("Scientific Imagery forwards polygon coordinates and scaling to the worker", async () => {
    const { readImageRegion } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");
    const polygon = [
        { row: 0, column: 0 },
        { row: 0, column: 2 },
        { row: 2, column: 0 }
    ];
    const expected = {
        statistics: { "50th percentile": -3 },
        valueLabel: "Real component",
        sampleCount: 3,
        sampled: false
    };

    assert.deepEqual(
        await readImageRegion(
            "scene.nitf",
            polygon,
            {},
            async (_python, args) => {
                assert.deepEqual(args.slice(1), [
                    "scene.nitf",
                    "--region",
                    JSON.stringify(polygon),
                    "real",
                    "100"
                ]);

                return { stdout: JSON.stringify(expected) };
            },
            "real",
            100
        ),
        expected
    );
});

test("image formation forwards explicit output and settings with a longer timeout", async () => {
    const { formSicd } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");
    const { defaultFormationSettings } =
        await import("../../src/types/formation.ts");

    await formSicd(
        "input.cphd",
        "output.sicd",
        defaultFormationSettings,
        { python: "python-test" },
        async (python, args, options) => {
            assert.equal(python, "python-test");
            assert.deepEqual(args.slice(1), [
                "input.cphd",
                "--form-sicd",
                "output.sicd",
                JSON.stringify(defaultFormationSettings)
            ]);
            assert.equal(options.timeout, 600_000);

            return { stdout: '{"path":"output.sicd"}' };
        }
    );
});

test("formed SICDs load durable diagnostic previews and tolerate damaged sidecars", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(
        path.join(tmpdir(), "nova-formation-preview-")
    );

    try {
        const file = path.join(directory, "formed.sicd");
        const products = [
            {
                id: "final",
                title: "Final",
                description: "Uncalibrated",
                previewDataUrl: "data:image/png;base64,eA=="
            }
        ];
        const run = async () => ({
            stdout: JSON.stringify({
                width: 64,
                height: 64,
                previewDataUrl: "data:image/png;base64,eA==",
                metadata: {
                    "Image formation application": "Nova CPU backprojection"
                }
            })
        });

        await writeFile(
            `${file}.formation.json`,
            JSON.stringify({ version: 1, products })
        );
        assert.deepEqual(
            (await openScientificImage(file, {}, run)).formationProducts,
            products
        );
        await writeFile(`${file}.formation.json`, "invalid json");

        const image = await openScientificImage(file, {}, run);

        assert.equal(image.width, 64);
        assert.equal(image.formationProducts, undefined);
        assert.match(
            String(image.metadata?.["Formation previews"]),
            /Unavailable/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("SIDD creation forwards the source, destination, and settings to the worker", async () => {
    const { createSidd } =
        await import("../../src-electron/electron-assets/plugins/scientific-imagery/index.ts");
    const { defaultSiddSettings } = await import("../../src/types/sidd");

    await createSidd(
        "input.sicd",
        "output.sidd",
        defaultSiddSettings,
        { python: "python-test" },
        async (python, args, options) => {
            assert.equal(python, "python-test");
            assert.deepEqual(args.slice(1), [
                "input.sicd",
                "--create-sidd",
                "output.sidd",
                JSON.stringify(defaultSiddSettings)
            ]);
            assert.equal(options.timeout, 600_000);

            return { stdout: '{"path":"output.sidd"}' };
        }
    );
});

test("reader failures show the actual diagnostic without font-cache chatter", async () => {
    await assert.rejects(
        openScientificImage("image.sicd", {}, async () => {
            throw Object.assign(new Error("failed"), {
                stderr: "Matplotlib is building the font cache\nThe SICDReader file writer generated an exception\nScientific Imagery could not read the image: Set SIDD pixel spacing to 0 for automatic sizing\n"
            });
        }),
        error => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /Set SIDD pixel spacing to 0/);
            assert.ok(!error.message.includes("Matplotlib"));

            return true;
        }
    );
});
