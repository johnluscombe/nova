import { test, expect } from "vitest";
import {
    metadataAxesCandidates,
    resolveMetadataAxes
} from "../../src/utils/metadata-axes";
import type { ImageInfo } from "../../src/types/image";
const axes = {
    row: { label: "Down-range", unit: "m" as const, origin: -20, spacing: 2 },
    column: {
        label: "Cross-range",
        unit: "m" as const,
        origin: -10,
        spacing: 0.5
    }
};
const image: ImageInfo = {
    name: "scene.tif",
    path: "/scene.tif",
    pluginId: "test",
    pluginName: "TIFF",
    width: 40,
    height: 20
};
function attached(data: unknown, path = "/metadata.json") {
    return { path, name: path.split("/").at(-1)!, data };
}
const json = { width: 40, height: 20, axes };
test("sidecar axes automatically fill missing axes and remain idempotent", () => {
    const source = { ...image, attachedMetadata: [attached(json)] };
    const result = resolveMetadataAxes(source);
    expect(result.axes).toEqual(axes);
    expect(result.axesSource).toBe("/metadata.json");
    expect(result.embeddedAxes).toBeUndefined();
    expect(resolveMetadataAxes(result)).toEqual(result);
    expect(resolveMetadataAxes(result, "embedded").axes).toBeUndefined();
    expect(source).not.toHaveProperty("axes");
});
test("embedded axes require an explicit override and can be restored", () => {
    const embedded = { ...axes, row: { ...axes.row, origin: 100 } };
    const source = {
        ...image,
        axes: embedded,
        attachedMetadata: [attached(json)]
    };
    expect(resolveMetadataAxes(source).axes).toEqual(embedded);
    const result = resolveMetadataAxes(source, "/metadata.json");
    expect(result.axes).toEqual(axes);
    expect(result.embeddedAxes).toEqual(embedded);
    expect(resolveMetadataAxes(result, "embedded").axes).toEqual(embedded);
    const missing = resolveMetadataAxes(
        { ...result, attachedMetadata: [] },
        "/metadata.json"
    );
    expect(missing.axes).toEqual(embedded);
    expect(missing.axesNotice).toContain("unavailable");
});
test("conflicting JSON sources need a selection while identical sources agree", () => {
    const alternate = {
        ...json,
        axes: { ...axes, column: { ...axes.column, origin: 50 } }
    };
    const source = {
        ...image,
        attachedMetadata: [attached(json), attached(alternate, "/other.json")]
    };
    expect(resolveMetadataAxes(source).axes).toBeUndefined();
    expect(resolveMetadataAxes(source).axesNotice).toContain("different axes");
    expect(resolveMetadataAxes(source, "/other.json").axes?.column.origin).toBe(
        50
    );
    expect(
        resolveMetadataAxes({
            ...image,
            attachedMetadata: [attached(json), attached(json, "/same.json")]
        }).axes
    ).toEqual(axes);
});
test("dimensions, numeric ranges, units and spacing are validated before use", () => {
    for (const data of [
        { axes },
        { image: { name: "different.tif", width: 40, height: 20 }, axes },
        { ...json, width: 41 },
        { ...json, axes: { ...axes, row: { ...axes.row, unit: "degrees" } } },
        { ...json, axes: { ...axes, row: { ...axes.row, spacing: 0 } } },
        { ...json, axes: { ...axes, row: { ...axes.row, spacing: Infinity } } },
        { ...json, axes: { ...axes, row: { ...axes.row, spacing: 1e308 } } }
    ]) {
        const source = { ...image, attachedMetadata: [attached(data)] };
        expect(metadataAxesCandidates(source)[0]?.error).toBeTruthy();
        expect(resolveMetadataAxes(source).axes).toBeUndefined();
    }
    expect(
        metadataAxesCandidates({
            ...image,
            attachedMetadata: [attached({ vendor: "Unknown" })]
        })[0]?.error
    ).toContain("No supported axis schema");
});
test("SICD exports account for scene center and chip offsets and avoid cross-product automatic application", () => {
    const data = {
        SICD: {
            ImageData: {
                NumRows: 20,
                NumCols: 40,
                FirstRow: 10,
                FirstCol: 20,
                SCPPixel: { Row: 12, Col: 25 }
            },
            Grid: { Type: "XRGYCR", Row: { SS: 2 }, Col: { SS: 0.5 } }
        }
    };
    const source = {
        ...image,
        metadata: { Format: "SICD / NITF" },
        attachedMetadata: [attached(data)]
    };
    expect(resolveMetadataAxes(source).axes).toEqual({
        row: { ...axes.row, origin: -4 },
        column: { ...axes.column, origin: -2.5 }
    });
    expect(
        resolveMetadataAxes({ ...source, metadata: { Format: "TIFF" } }).axes
    ).toBeUndefined();
    expect(
        resolveMetadataAxes(
            { ...source, metadata: { Format: "TIFF" } },
            "/metadata.json"
        ).axes?.row.origin
    ).toBe(-4);
    data.SICD.Grid.Type = "XCTYAT";
    expect(resolveMetadataAxes(source).axes?.row.label).toBe("Cross-track");
});
test("SIDD plane metadata uses the product reference point and spacing", () => {
    const data = {
        SIDD: {
            Measurement: {
                PixelFootprint: { Row: 20, Col: 40 },
                PlaneProjection: {
                    ReferencePoint: { Point: { Row: 10, Col: 20 } },
                    SampleSpacing: { Row: 2, Col: 0.5 }
                }
            }
        }
    };
    const source = {
        ...image,
        metadata: { Format: "SIDD / NITF" },
        attachedMetadata: [attached(data)]
    };
    expect(resolveMetadataAxes(source).axes).toEqual({
        row: { ...axes.row, label: "Row distance" },
        column: { ...axes.column, label: "Column distance" }
    });
});
