import { test, expect } from "vitest";
import { sliceAxes, slicePosition } from "../../src/utils/slice-axes";
import type { ImageInfo } from "../../src/types/image";
const image: ImageInfo = {
    name: "radar",
    path: "/radar",
    pluginId: "sicd",
    pluginName: "SICD",
    axes: {
        row: { label: "Down-range", unit: "m", origin: -20, spacing: 2 },
        column: { label: "Cross-range", unit: "m", origin: -10, spacing: 0.5 }
    }
};
const data = {
    positionLabel: "Column (pixel)",
    valueLabel: "Amplitude",
    points: [
        { position: 0, value: 5 },
        { position: 3, value: null },
        { position: 6, value: 10 }
    ]
};
test("slice graph positions use the varying physical axis and preserve sampling gaps", () => {
    const horizontal = sliceAxes(data, image, "horizontal");
    expect(horizontal.positionLabel).toBe("Cross-range (m)");
    expect(horizontal.points).toEqual([
        { position: -10, value: 5 },
        { position: -8.5, value: null },
        { position: -7, value: 10 }
    ]);
    const vertical = sliceAxes(data, image, "vertical");
    expect(vertical.positionLabel).toBe("Down-range (m)");
    expect(vertical.points.map(point => point.position)).toEqual([
        -20, -14, -8
    ]);
    expect(data.points[0]?.position).toBe(0);
    expect(slicePosition(image, "horizontal", 3)).toBe(
        "Down-range -14 m (row 3)"
    );
    expect(slicePosition(image, "vertical", 5)).toBe(
        "Cross-range -7.5 m (column 5)"
    );
});
test("images without physical axes keep pixel coordinates and labels", () => {
    const { axes: _axes, ...plain } = image;
    expect(sliceAxes(data, plain, "horizontal")).toBe(data);
    expect(slicePosition(plain, "horizontal", 3)).toBe("row 3");
    expect(slicePosition(plain, "vertical", 5)).toBe("column 5");
});
