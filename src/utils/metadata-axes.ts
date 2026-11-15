import {
    axisCoordinate,
    validateImageAxes,
    type ImageAxes
} from "../types/axes";
import type { ImageInfo } from "../types/image";

/**
 * Axis interpretation proposed by one attached metadata file, including its
 * schema, selection policy, or validation failure.
 */
export interface MetadataAxesCandidate {
    path: string;

    name: string;

    axes?: ImageAxes;

    /** Recognized metadata convention used to interpret the axes. */
    schema?: string;

    /**
     * Whether this interpretation may be selected without explicit user
     * confirmation.
     */
    automatic?: boolean;

    /** Validation failure explaining why this candidate cannot supply axes. */
    error?: string;
}

/**
 * Treat a non-null object as metadata, otherwise return an empty record
 * for safe field access.
 */
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Require a finite numeric metadata value and report the offending field
 * when invalid.
 */
function number(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number.`);
    }

    return value;
}

/**
 * Require a positive, finite physical sample spacing.
 */
function spacing(value: unknown): number {
    const result = number(value, "Pixel spacing");

    if (result <= 0) {
        throw new Error("Pixel spacing must be positive.");
    }

    return result;
}

/**
 * Require metadata dimensions to match the source image pixel grid.
 */
function dimensions(width: unknown, height: unknown, image: ImageInfo) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
        throw new Error(
            "Axis metadata must include integer image width and height."
        );
    }

    if (width !== image.width || height !== image.height) {
        throw new Error(
            "Metadata dimensions do not match this image's pixel grid."
        );
    }
}

/**
 * Derive meter axes from a supported SICD grid, scene-center pixel, and
 * chip offsets.
 */
function sicdAxes(data: Record<string, unknown>, image: ImageInfo): ImageAxes {
    const grid = object(data.Grid),
        pixels = object(data.ImageData),
        center = object(pixels.SCPPixel);

    dimensions(pixels.NumCols, pixels.NumRows, image);

    const labels: Record<string, [string, string]> = {
        XRGYCR: ["Down-range", "Cross-range"],
        RGAZIM: ["Down-range", "Cross-range (azimuth)"],
        RGZERO: ["Down-range", "Cross-range (azimuth)"],
        XCTYAT: ["Cross-track", "Along-track"],
        PLANE: ["Row distance", "Column distance"]
    };

    if (typeof grid.Type !== "string" || !labels[grid.Type]) {
        throw new Error("Unsupported SICD grid type.");
    }

    const axes = {} as ImageAxes;

    for (const [key, direction, offset, label] of [
        ["row", "Row", "FirstRow", labels[grid.Type]![0]],
        ["column", "Col", "FirstCol", labels[grid.Type]![1]]
    ] as const) {
        const step = spacing(object(grid[direction]).SS);
        const first = number(pixels[offset], offset);

        if (!Number.isSafeInteger(first) || first < 0) {
            throw new Error("SICD chip offsets must be nonnegative integers.");
        }

        axes[key] = {
            label,
            unit: "m",
            spacing: step,
            origin:
                (first - number(center[direction], "Scene-center pixel")) * step
        };
    }

    return axes;
}

/**
 * Interpret explicit, SICD, or planar SIDD coordinate metadata and report
 * its override policy.
 */
function parseAxes(
    value: unknown,
    image: ImageInfo
):
    | {
          axes: ImageAxes;

          schema: string;

          automatic: boolean;
      }
    | undefined {
    const root = object(value),
        data = object(root.SICD ?? root.SIDD ?? value);
    let axes: ImageAxes, schema: string;

    if (data.axes !== undefined) {
        const size = object(data.image);

        if (size.name !== undefined && size.name !== image.name) {
            throw new Error("Axis metadata names a different image.");
        }

        const rawAxes = object(data.axes);

        if (
            ![object(rawAxes.row).unit, object(rawAxes.column).unit].every(
                unit => unit === "m" || unit === "pixel"
            )
        ) {
            throw new Error(
                "Axes require explicit meter (m) or pixel units; geographic coordinates need projection."
            );
        }

        dimensions(data.width ?? size.width, data.height ?? size.height, image);
        axes = validateImageAxes(data.axes);
        schema = "Image axes";
    } else if (data.Grid !== undefined && data.ImageData !== undefined) {
        axes = sicdAxes(data, image);
        schema = "SICD";
    } else if (data.Measurement !== undefined) {
        const measurement = object(data.Measurement),
            size = object(measurement.PixelFootprint);

        dimensions(size.Col, size.Row, image);

        const plane = object(measurement.PlaneProjection),
            steps = object(plane.SampleSpacing),
            point = object(object(plane.ReferencePoint).Point);

        axes = {
            row: {
                label: "Row distance",
                unit: "m",
                spacing: spacing(steps.Row),
                origin: -number(point.Row, "Reference row") * spacing(steps.Row)
            },
            column: {
                label: "Column distance",
                unit: "m",
                spacing: spacing(steps.Col),
                origin:
                    -number(point.Col, "Reference column") * spacing(steps.Col)
            }
        };
        schema = "SIDD plane projection";
    } else {
        return undefined;
    }

    validateImageAxes(axes);

    if (
        !Number.isFinite(axisCoordinate(axes.row, image.height! - 1)) ||
        !Number.isFinite(axisCoordinate(axes.column, image.width! - 1))
    ) {
        throw new Error("Axis coordinates exceed the supported numeric range.");
    }

    return {
        schema,
        automatic:
            schema === "Image axes" ||
            (schema === "SICD" &&
                String(image.metadata?.Format).startsWith("SICD")) ||
            (schema.startsWith("SIDD") &&
                String(image.metadata?.Format).startsWith("SIDD")),
        axes: {
            row: { ...axes.row },
            column: { ...axes.column }
        }
    };
}

/**
 * Inspect attached JSON files for compatible axes while retaining per-file
 * validation notices.
 */
export function metadataAxesCandidates(
    image: ImageInfo
): MetadataAxesCandidate[] {
    return (image.attachedMetadata ?? []).map(item => {
        const base = { path: item.path, name: item.name };

        if (item.error) {
            return { ...base, error: "Metadata is unavailable." };
        }

        try {
            const parsed = parseAxes(item.data, image);

            return parsed
                ? { ...base, ...parsed }
                : {
                      ...base,
                      error: "No supported axis schema found; metadata is available for reference."
                  };
        } catch (cause) {
            return {
                ...base,
                error: cause instanceof Error ? cause.message : String(cause)
            };
        }
    });
}

/**
 * Compare both axis labels, units, origins, and spacings for
 * coordinate-source equivalence.
 */
function equalAxes(a: ImageAxes, b: ImageAxes) {
    return (["row", "column"] as const).every(
        key =>
            a[key].label === b[key].label &&
            a[key].unit === b[key].unit &&
            a[key].origin === b[key].origin &&
            a[key].spacing === b[key].spacing
    );
}

/**
 * Preserve embedded coordinates unless the user explicitly chooses another
 * source.
 */
export function resolveMetadataAxes(
    image: ImageInfo,
    preference?: string
): ImageInfo {
    const embedded =
        image.axesSource !== undefined ? image.embeddedAxes : image.axes;
    const {
        axes: _axes,
        embeddedAxes: _embedded,
        axesSource: _source,
        axesNotice: _notice,
        ...base
    } = image;
    let axes = embedded,
        source = embedded ? "embedded" : "pixel",
        notice: string | undefined;
    const candidates = metadataAxesCandidates(image).filter(item => item.axes);

    if (preference && preference !== "embedded") {
        const selected = candidates.find(item => item.path === preference);

        if (selected?.axes) {
            axes = selected.axes;
            source = selected.path;
        } else {
            notice =
                "Selected metadata axes are unavailable; using embedded or pixel coordinates.";
        }
    } else if (!embedded && preference === undefined && candidates.length) {
        const first = candidates[0]!;

        if (
            candidates.every(item => equalAxes(item.axes!, first.axes!)) &&
            candidates.every(item => item.automatic)
        ) {
            axes = first.axes;
            source = first.path;
        } else {
            notice = candidates.every(item =>
                equalAxes(item.axes!, first.axes!)
            )
                ? "Source-grid metadata found. Use these axes only if this image uses the same pixel grid."
                : "Metadata files define different axes. Choose which file to use.";
        }
    }

    return {
        ...base,
        axesSource: source,
        ...(axes ? { axes } : {}),
        ...(embedded ? { embeddedAxes: embedded } : {}),
        ...(notice ? { axesNotice: notice } : {})
    };
}
