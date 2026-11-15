import type { ImageInfo } from "../types/image";
import {
    polygonIntervals,
    validatePolygon,
    type PolygonPoint,
    type RegionStatistics
} from "../types/region";
export function percentileStatistics(
    values: number[]
): Record<string, number | null> {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return Object.fromEntries(
        Array.from({ length: 101 }, (_, p) => {
            const suffix =
                p >= 11 && p <= 13
                    ? "th"
                    : ((
                          { 1: "st", 2: "nd", 3: "rd" } as Record<
                              number,
                              string
                          >
                      )[p % 10] ?? "th");
            const position = (p * (sorted.length - 1)) / 100,
                low = Math.floor(position),
                high = Math.ceil(position);
            const value = sorted.length
                ? sorted[low]! +
                  (sorted[high]! - sorted[low]!) * (position - low)
                : null;
            return [`${p}${suffix} percentile`, value];
        })
    );
}
export async function previewRegionStatistics(
    image: ImageInfo,
    polygon?: PolygonPoint[]
): Promise<RegionStatistics> {
    if (!image.previewDataUrl) {
        throw new Error("This image has no preview to sample.");
    }
    const decoded = new Image();
    decoded.src = image.previewDataUrl;
    await decoded.decode();
    const width = image.width ?? decoded.naturalWidth,
        height = image.height ?? decoded.naturalHeight;
    const points = polygon
        ? validatePolygon(polygon, width, height)
        : undefined;
    const scale = Math.min(
        1,
        1600 / Math.max(decoded.naturalWidth, decoded.naturalHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(decoded.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Region sampling is unavailable.");
    }
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const whole: number[] = [],
        selected: number[] = [];
    for (let y = 0; y < canvas.height; y++) {
        const intervals = points
            ? polygonIntervals(((y + 0.5) * height) / canvas.height, points)
            : [[0, width]];
        let intervalIndex = 0;
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (!pixels[i + 3]) {
                continue;
            }
            const value =
                0.2126 * pixels[i]! +
                0.7152 * pixels[i + 1]! +
                0.0722 * pixels[i + 2]!;
            whole.push(value);
            const column = ((x + 0.5) * width) / canvas.width;
            while (
                intervalIndex < intervals.length &&
                column > intervals[intervalIndex]![1]! + 1e-8
            ) {
                intervalIndex++;
            }
            if (
                intervalIndex < intervals.length &&
                column >= intervals[intervalIndex]![0]! - 1e-8
            ) {
                if (points) {
                    selected.push(value);
                }
            }
        }
    }
    const statistics = percentileStatistics(points ? selected : whole);
    return {
        statistics,
        wholeImageStatistics: points ? percentileStatistics(whole) : statistics,
        valueLabel: "Preview luminance (0–255)",
        sampleCount: points ? selected.length : whole.length,
        sampled: canvas.width !== width || canvas.height !== height
    };
}
