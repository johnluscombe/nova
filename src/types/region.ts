export interface PolygonPoint {
    row: number;
    column: number;
}
export interface RegionStatistics {
    statistics: Record<string, number | null>;
    valueLabel: string;
    sampleCount: number;
    sampled: boolean;
    wholeImageStatistics?: Record<string, number | null>;
}
export interface RegionState {
    available: boolean;
    drawing: boolean;
    selected: boolean;
}
function cross(a: PolygonPoint, b: PolygonPoint, c: PolygonPoint) {
    return (
        (b.column - a.column) * (c.row - a.row) -
        (b.row - a.row) * (c.column - a.column)
    );
}
function onSegment(a: PolygonPoint, b: PolygonPoint, p: PolygonPoint) {
    return (
        Math.abs(cross(a, b, p)) < 1e-8 &&
        p.row >= Math.min(a.row, b.row) &&
        p.row <= Math.max(a.row, b.row) &&
        p.column >= Math.min(a.column, b.column) &&
        p.column <= Math.max(a.column, b.column)
    );
}
function intersects(
    a: PolygonPoint,
    b: PolygonPoint,
    c: PolygonPoint,
    d: PolygonPoint
) {
    const abC = cross(a, b, c),
        abD = cross(a, b, d),
        cdA = cross(c, d, a),
        cdB = cross(c, d, b);
    return (
        (abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
    );
}
export function validatePolygon(
    value: unknown,
    width: number,
    height: number
): PolygonPoint[] {
    if (!Array.isArray(value) || value.length < 3 || value.length > 256) {
        throw new Error("A polygon needs 3–256 vertices.");
    }
    const points = value.map((point: unknown) => {
        const p = point as PolygonPoint | null;
        if (
            !p ||
            typeof p.row !== "number" ||
            typeof p.column !== "number" ||
            !Number.isFinite(p.row) ||
            !Number.isFinite(p.column) ||
            p.row < 0 ||
            p.column < 0 ||
            p.row > height ||
            p.column > width
        ) {
            throw new Error("Polygon vertices must be inside the image.");
        }
        return { row: p.row, column: p.column };
    });
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!,
            b = points[(i + 1) % points.length]!;
        if (a.row === b.row && a.column === b.column) {
            throw new Error("Polygon vertices must be distinct.");
        }
        area += a.column * b.row - b.column * a.row;
        for (let j = i + 1; j < points.length; j++) {
            if (j === i + 1 || (i === 0 && j === points.length - 1)) {
                continue;
            }
            if (
                intersects(a, b, points[j]!, points[(j + 1) % points.length]!)
            ) {
                throw new Error("Polygon edges must not cross.");
            }
        }
    }
    if (Math.abs(area) < 1e-8) {
        throw new Error("Polygon must enclose an area.");
    }
    return points;
}
/** Coordinates are image edges; test pixel centers against the closed polygon. */
export function insidePolygon(
    row: number,
    column: number,
    points: PolygonPoint[]
): boolean {
    let inside = false;
    const p = { row, column };
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j]!,
            b = points[i]!;
        if (onSegment(a, b, p)) {
            return true;
        }
        if (
            a.row > row !== b.row > row &&
            column <
                ((b.column - a.column) * (row - a.row)) / (b.row - a.row) +
                    a.column
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/** Even/odd scanline intervals, including polygon boundaries, for preview sampling. */
export function polygonIntervals(
    row: number,
    points: PolygonPoint[]
): [number, number][] {
    const crossings: number[] = [],
        intervals: [number, number][] = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!,
            b = points[(i + 1) % points.length]!;
        if (a.row > row !== b.row > row) {
            crossings.push(
                a.column +
                    ((b.column - a.column) * (row - a.row)) / (b.row - a.row)
            );
        }
        if (Math.abs(a.row - row) < 1e-8) {
            intervals.push([a.column, a.column]);
        }
        if (Math.abs(a.row - b.row) < 1e-8 && Math.abs(a.row - row) < 1e-8) {
            intervals.push([
                Math.min(a.column, b.column),
                Math.max(a.column, b.column)
            ]);
        }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
        intervals.push([crossings[i]!, crossings[i + 1]!]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1] + 1e-8) {
            last[1] = Math.max(last[1], interval[1]);
        } else {
            merged.push([...interval]);
        }
    }
    return merged;
}
