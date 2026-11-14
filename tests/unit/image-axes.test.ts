import { test, expect } from "vitest";
import {
    axisCoordinate,
    axisTicks,
    validateImageAxes
} from "../../src/types/axes";
const row = {
    label: "Down-range",
    unit: "m" as const,
    origin: -20,
    spacing: 2
};
const column = {
    label: "Cross-range",
    unit: "m" as const,
    origin: -10,
    spacing: 0.5
};
test("axes map source pixel centers to signed physical coordinates", () => {
    expect(validateImageAxes({ row, column })).toEqual({ row, column });
    expect(axisCoordinate(row, 3)).toBe(-14);
    expect(axisCoordinate(column, 5)).toBe(-7.5);
    const ticks = axisTicks(row, 21, 400);
    expect(ticks[0]).toEqual({ fraction: 0.5 / 21, value: -20 });
    expect(ticks.at(-1)).toEqual({ fraction: 20.5 / 21, value: 20 });
    expect(ticks[2]?.value).toBe(0);
    expect(axisTicks(row, 1, 100)).toEqual([{ fraction: 0.5, value: -20 }]);
    expect(axisTicks(row, 0, 100)).toEqual([]);
    expect(axisTicks(row, 20, 0)).toEqual([]);
    expect(axisTicks(row, 20, 80)).toHaveLength(2);
});
test("axes reject missing directions and invalid scales or labels", () => {
    for (const value of [
        null,
        {},
        { row },
        { row, column: { ...column, unit: "unknown" } },
        { row: { ...row, spacing: 0 }, column },
        { row: { ...row, origin: NaN }, column },
        { row: { ...row, spacing: Infinity }, column },
        { row: { ...row, label: "" }, column }
    ]) {
        expect(() => validateImageAxes(value)).toThrow("Invalid image axes");
    }
});
