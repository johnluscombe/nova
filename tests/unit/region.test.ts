import { test, expect } from "vitest";
import {
    validatePolygon,
    insidePolygon,
    polygonIntervals
} from "../../src/types/region";
import { percentileStatistics } from "../../src/utils/region-statistics";
const rectangle = [
    { row: 0, column: 0 },
    { row: 0, column: 4 },
    { row: 3, column: 4 },
    { row: 3, column: 0 }
];
test("polygon validation rejects crossings, degenerate shapes and out-of-bounds vertices", () => {
    expect(validatePolygon(rectangle, 4, 3)).toEqual(rectangle);
    for (const points of [
        rectangle.slice(0, 2),
        [{ row: -1, column: 0 }, ...rectangle.slice(1)],
        [{ row: NaN, column: 0 }, ...rectangle.slice(1)],
        [
            { row: 0, column: 0 },
            { row: 1, column: 1 },
            { row: 2, column: 2 }
        ],
        [rectangle[0], rectangle[2], rectangle[1], rectangle[3]]
    ]) {
        expect(() => validatePolygon(points, 4, 3)).toThrow();
    }
});
test("concave polygon scanlines agree with point tests, including boundaries", () => {
    const concave = [
        { row: 0, column: 0 },
        { row: 0, column: 4 },
        { row: 1, column: 4 },
        { row: 1, column: 1 },
        { row: 3, column: 1 },
        { row: 3, column: 0 }
    ];
    expect(validatePolygon(concave, 4, 3)).toEqual(concave);
    let count = 0;
    for (let row = 0; row <= 3; row += 0.5) {
        for (let column = 0; column <= 4; column += 0.5) {
            const expected = insidePolygon(row, column, concave);
            const actual = polygonIntervals(row, concave).some(
                ([left, right]) => column >= left && column <= right
            );
            expect(actual).toBe(expected);
            if (expected && row % 1 === 0.5 && column % 1 === 0.5) {
                count++;
            }
        }
    }
    expect(count).toBe(6);
    expect(insidePolygon(1.5, 2.5, concave)).toBe(false);
});
test("region percentiles interpolate finite samples and handle empty regions", () => {
    const stats = percentileStatistics([0, 2, 4, NaN, Infinity]);
    expect(stats["0th percentile"]).toBe(0);
    expect(stats["25th percentile"]).toBe(1);
    expect(stats["50th percentile"]).toBe(2);
    expect(stats["99th percentile"]).toBe(3.96);
    expect(Object.keys(stats)).toHaveLength(101);
    expect(
        Object.values(percentileStatistics([])).every(value => value === null)
    ).toBe(true);
});
