"""Read SICD complex imagery and SIDD derived imagery using SarPy."""
import base64
import contextlib
import json
import math
import struct
import sys
import zlib


def png_preview(pixels):
    height, width = pixels.shape[:2]
    color_type = 2 if pixels.ndim == 3 else 0
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    scanlines = b"".join(b"\x00" + row.tobytes() for row in pixels)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b"")


def open_radar_reader(file_path):
    from sarpy.io.product.sidd import SIDDReader, SIDDDetails
    from sarpy.io.complex.sicd import SICDReader
    from sarpy.io.general.base import SarpyIOError
    # SIDD products may embed source SICD metadata. Inspect SIDD first so that
    # derived image pixels are never interpreted as complex source samples.
    try:
        details = SIDDDetails(file_path)
    except (SarpyIOError, ValueError):
        return SICDReader(file_path)
    return SIDDReader(details)


def sidd_metadata(metadata):
    fields = {"Product": "ProductCreation.ProductName", "Product class": "ProductCreation.ProductClass",
              "Classification": "ProductCreation.Classification.classification", "Pixel type": "Display.PixelType",
              "Projection": "Measurement.ProjectionType"}
    result = {"Format": "SIDD / NITF", "Image selection": "First derived image"}
    for label, field in fields.items():
        value = metadata
        for part in field.split("."):
            value = getattr(value, part, None)
        if value is not None:
            result[label] = str(value)
    collections = getattr(getattr(metadata, "ExploitationFeatures", None), "Collections", None)
    if collections:
        information = getattr(collections[0], "Information", None)
        for label, field in (("Sensor", "SensorName"), ("Collection time (UTC)", "CollectionDateTime"), ("Duration (seconds)", "CollectionDuration")):
            value = getattr(information, field, None)
            if value is not None:
                result[label] = str(value)
    return result


def sidd_axes(metadata):
    measurement = getattr(metadata, "Measurement", None)
    plane = getattr(measurement, "PlaneProjection", None)
    spacing = getattr(plane, "SampleSpacing", None)
    reference = getattr(getattr(plane, "ReferencePoint", None), "Point", None)
    if spacing is None or reference is None:
        return None
    axes = {}
    for key, direction in (("row", "Row"), ("column", "Col")):
        step, center = getattr(spacing, direction, None), getattr(reference, direction, None)
        if not valid_spacing(step) or center is None or not math.isfinite(center):
            return None
        axes[key] = {"label": "Row distance" if key == "row" else "Column distance", "unit": "m", "origin": -center * step, "spacing": step}
    return axes


def sidd_values(samples):
    import numpy as np
    if samples.ndim == 2:
        return samples.astype(np.float64), "Derived image intensity"
    if samples.ndim == 3 and samples.shape[-1] == 1:
        return samples[..., 0].astype(np.float64), "Derived image intensity"
    if samples.ndim == 3 and samples.shape[-1] == 3:
        return samples.astype(np.float64) @ np.array([0.2126, 0.7152, 0.0722]), "Source RGB luminance (0–255)"
    raise ValueError("Unsupported SIDD image bands")


def render_sidd(reader):
    import numpy as np
    metadata = reader.get_sidds_as_tuple()[0]
    height, width = reader.get_data_size_as_tuple()[0][:2]
    if width <= 0 or height <= 0:
        raise ValueError("Invalid SIDD dimensions")
    step = max(1, math.ceil(max(width, height) / 1600))
    # Read one sampled row at a time, preserving RGB channels and bounding memory.
    preview = None
    for out_row, row in enumerate(range(0, height, step)):
        samples = reader.read(slice(row, row + 1), slice(0, width, step), index=0, squeeze=False)
        if preview is None:
            preview = np.empty((math.ceil(height / step),) + samples.shape[1:], dtype=samples.dtype)
        preview[out_row] = samples[0]
    values, value_label = sidd_values(preview)
    info = sidd_metadata(metadata)
    info["Statistics quantity"] = value_label
    info["Image selection"] = f"First of {len(reader.get_sidds_as_tuple())} derived image(s)"
    if preview.dtype == np.uint8:
        pixels = preview[..., 0] if preview.ndim == 3 and preview.shape[-1] == 1 else preview
        info["Preview"] = "Derived display values (no additional stretch)"
    else:
        finite = np.isfinite(values)
        pixels = np.zeros(values.shape, dtype=np.uint8)
        if finite.any():
            low, high = np.percentile(values[finite], [1, 99])
            if high > low:
                pixels = np.clip(np.where(finite, (values - low) / (high - low), 0) * 255, 0, 255).astype(np.uint8)
            else:
                pixels[finite] = 127
        info["Preview"] = "Derived intensity, 1st–99th percentile stretch"
    axes = sidd_axes(metadata)
    return {"width": int(width), "height": int(height), "metadata": info,
            "statistics": image_statistics(values), **({"axes": axes} if axes else {}),
            "previewDataUrl": "data:image/png;base64," + base64.b64encode(png_preview(pixels)).decode("ascii")}


def sidd_slice(reader, orientation, index, scaling):
    import numpy as np
    if scaling != "amplitude":
        raise ValueError("SIDD derived pixels do not support complex scaling")
    height, width = reader.get_data_size_as_tuple()[0][:2]
    horizontal = orientation == "horizontal"
    limit, length = (height, width) if horizontal else (width, height)
    if not 0 <= index < limit:
        raise ValueError("Slice index is outside the image")
    step = max(1, math.ceil(length / 4096))
    rows, columns = ((slice(index, index + 1), slice(0, width, step)) if horizontal else
                     (slice(0, height, step), slice(index, index + 1)))
    values, label = sidd_values(reader.read(rows, columns, index=0, squeeze=False))
    return {"points": [{"position": position, "value": float(value) if np.isfinite(value) else None}
                       for position, value in zip(range(0, length, step), values.reshape(-1))],
            "positionLabel": "Column (pixel)" if horizontal else "Row (pixel)", "valueLabel": label}


def sidd_pixel(reader, row, column, scaling):
    import numpy as np
    if scaling != "amplitude":
        raise ValueError("SIDD derived pixels do not support complex scaling")
    height, width = reader.get_data_size_as_tuple()[0][:2]
    if not (0 <= row < height and 0 <= column < width):
        raise ValueError("Pixel is outside the image")
    values, label = sidd_values(reader.read(slice(row, row + 1), slice(column, column + 1), index=0, squeeze=False))
    value = float(values[0, 0])
    return {"value": value if np.isfinite(value) else None, "valueLabel": label}


def image_metadata(metadata):
    fields = {
        "Collector": "CollectionInfo.CollectorName",
        "Collection": "CollectionInfo.CoreName",
        "Classification": "CollectionInfo.Classification",
        "Radar mode": "CollectionInfo.RadarMode.ModeType",
        "Collection time (UTC)": "Timeline.CollectStart",
        "Duration (seconds)": "Timeline.CollectDuration",
        "Pixel type": "ImageData.PixelType",
        "Image plane": "Grid.ImagePlane",
        "Grid type": "Grid.Type",
        "Row spacing (m)": "Grid.Row.SS",
        "Column spacing (m)": "Grid.Col.SS",
        "Polarization": "ImageFormation.TxRcvPolarizationProc",
        "Side of track": "SCPCOA.SideOfTrack",
        "Grazing angle (degrees)": "SCPCOA.GrazeAng",
    }
    result = {"Format": "SICD / NITF", "Preview": "Log magnitude, 1st–99th percentile stretch"}
    for label, field in fields.items():
        value = metadata
        for part in field.split("."):
            value = getattr(value, part, None)
        if value is not None:
            result[label] = str(value)
    return result


def image_axes(metadata):
    grid, image = getattr(metadata, "Grid", None), getattr(metadata, "ImageData", None)
    center = getattr(image, "SCPPixel", None)
    if grid is None or center is None:
        return None
    grid_type = getattr(grid, "Type", None)
    # Preserve the actual grid directions; arbitrary planes cannot be relabeled
    # as range/cross-range without resampling the image.
    labels = {
        "XRGYCR": ("Down-range", "Cross-range"),
        "RGAZIM": ("Down-range", "Cross-range (azimuth)"),
        "RGZERO": ("Down-range", "Cross-range (azimuth)"),
        "XCTYAT": ("Cross-track", "Along-track"),
    }.get(grid_type, ("Row distance", "Column distance"))
    axes = {}
    for key, direction, first, label in zip(("row", "column"), ("Row", "Col"), ("FirstRow", "FirstCol"), labels):
        spacing = getattr(getattr(grid, direction, None), "SS", None)
        offset, scp = getattr(image, first, None), getattr(center, direction, None)
        if not valid_spacing(spacing) or offset is None or scp is None:
            return None
        origin = (offset - scp) * spacing
        if not math.isfinite(origin):
            return None
        axes[key] = {"label": label, "unit": "m", "origin": origin, "spacing": spacing}
    return axes


def image_statistics(magnitude):
    import numpy as np
    values = magnitude[np.isfinite(magnitude)].astype(np.float64)
    percentiles = list(range(101))
    def label(value):
        suffix = "th" if 10 <= value % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
        return f"{value}{suffix} percentile"
    labels = [label(value) for value in percentiles]
    if not values.size:
        return dict.fromkeys(labels)
    return dict(zip(labels, map(float, np.percentile(values, percentiles))))


SCALING_LABELS = {
    "amplitude": "Source amplitude", "real": "Real component", "imaginary": "Imaginary component",
    "phase": "Phase (degrees)", "power": "Power (linear)", "log-power": "Power (dB, reference = 1 source power unit)",
    "relative-power": "Relative power (dB, sampled peak = 0)",
    "rcs": "RCS (m²)", "rcs-db": "RCS (dBsm)",
    "sigma-zero": "Sigma-zero (linear)", "sigma-zero-db": "Sigma-zero (dB)",
    "beta-zero": "Beta-zero (linear)", "beta-zero-db": "Beta-zero (dB)",
    "gamma-zero": "Gamma-zero (linear)", "gamma-zero-db": "Gamma-zero (dB)",
}
CALIBRATION_FIELDS = {"rcs": "RCSSFPoly", "sigma-zero": "SigmaZeroSFPoly",
                      "beta-zero": "BetaZeroSFPoly", "gamma-zero": "GammaZeroSFPoly"}


def valid_spacing(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def scaling_options(metadata):
    options = list(SCALING_LABELS)[:7]
    radiometric = getattr(metadata, "Radiometric", None)
    grid = getattr(metadata, "Grid", None)
    image = getattr(metadata, "ImageData", None)
    # Calibration polynomials use physical coordinates relative to the SCP.
    if (getattr(image, "SCPPixel", None) is not None and
            all(valid_spacing(getattr(getattr(grid, axis, None), "SS", None)) for axis in ("Row", "Col"))):
        for mode, field in CALIBRATION_FIELDS.items():
            if getattr(radiometric, field, None) is not None:
                options.extend([mode, mode + "-db"])
    return options


def scale_samples(samples, metadata, rows, columns, scaling):
    import numpy as np
    if scaling not in scaling_options(metadata):
        raise ValueError("Scaling is unavailable for this image")
    samples = np.asarray(samples, dtype=np.complex128)
    samples = np.where(np.isfinite(samples), samples, complex(float("nan"), float("nan")))
    if scaling == "real":
        return samples.real
    if scaling == "imaginary":
        return samples.imag
    if scaling == "phase":
        return np.where(np.abs(samples) > 0, np.angle(samples, deg=True), np.nan)
    if scaling == "amplitude":
        return np.abs(samples)
    power = np.abs(samples) ** 2
    base = scaling.removesuffix("-db")
    if base in CALIBRATION_FIELDS:
        image, grid = metadata.ImageData, metadata.Grid
        row_coords = (np.asarray(rows) + image.FirstRow - image.SCPPixel.Row) * grid.Row.SS
        col_coords = (np.asarray(columns) + image.FirstCol - image.SCPPixel.Col) * grid.Col.SS
        row_grid, col_grid = np.broadcast_arrays(row_coords[:, None], col_coords[None, :])
        factor = getattr(metadata.Radiometric, CALIBRATION_FIELDS[base])(row_grid, col_grid)
        power = np.where(np.isfinite(factor) & (factor > 0), power * factor, np.nan)
    if scaling == "relative-power":
        finite = power[np.isfinite(power) & (power > 0)]
        power = power / finite.max() if finite.size else np.full_like(power, np.nan)
    if scaling in ("log-power", "relative-power") or scaling.endswith("-db"):
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(power > 0, 10 * np.log10(power), np.nan)
    return power


def render(file_path, scaling="amplitude"):
    import numpy as np

    with open(file_path, "rb") as source:
        if source.read(9) != b"NITF02.10":
            raise ValueError("SICD/SIDD requires a NITF 2.1 file")
    reader = open_radar_reader(file_path)
    try:
        if reader.reader_type == "SIDD":
            if scaling != "amplitude":
                raise ValueError("SIDD derived pixels do not support complex scaling")
            return render_sidd(reader)
        metadata = reader.get_sicds_as_tuple()[0]
        height, width = int(metadata.ImageData.NumRows), int(metadata.ImageData.NumCols)
        if width <= 0 or height <= 0:
            raise ValueError("Invalid SICD dimensions")
        step = max(1, math.ceil(max(width, height) / 1600))
        # Read one sampled row at a time, keeping complex sample memory bounded.
        complex_samples = np.empty((math.ceil(height / step), math.ceil(width / step)), dtype=np.complex64)
        for output_row, source_row in enumerate(range(0, height, step)):
            samples = reader.read(slice(source_row, source_row + 1), slice(0, width, step), index=0, squeeze=False)
            complex_samples[output_row] = samples.reshape(-1)
        values = scale_samples(complex_samples, metadata, range(0, height, step), range(0, width, step), scaling)
        finite = np.isfinite(values) & (values > 0 if scaling == "amplitude" else True)
        # Preserve the familiar log-amplitude preview. Other modes display their
        # selected numerical quantity with a percentile contrast stretch.
        display = np.log1p(values) if scaling == "amplitude" else values
        pixels = np.zeros(values.shape, dtype=np.uint8)
        if finite.any():
            low, high = np.percentile(display[finite], [1, 99])
            if high > low:
                stretched = np.where(finite, (display - low) / (high - low), 0)
                pixels = np.clip(stretched * 255, 0, 255).astype(np.uint8)
            else:
                pixels[finite] = 127
        info = image_metadata(metadata)
        info["Scaling"] = SCALING_LABELS[scaling]
        info["Preview"] = ("Log amplitude" if scaling == "amplitude" else SCALING_LABELS[scaling]) + ", 1st–99th percentile stretch"
        power = np.abs(complex_samples.astype(np.complex128)) ** 2
        finite_power = power[np.isfinite(power)]
        axes = image_axes(metadata)
        return {**({"axes": axes} if axes else {}), "peakPower": float(finite_power.max()) if finite_power.size else 0,
                "scalingOptions": scaling_options(metadata), "scaling": scaling,
                "statistics": image_statistics(values), "metadata": info, "width": width, "height": height,
                "previewDataUrl": "data:image/png;base64," + base64.b64encode(png_preview(pixels)).decode("ascii")}

    finally:
        reader.close()


def slice_image(file_path, orientation, index, scaling="amplitude"):
    import numpy as np
    if orientation not in ("horizontal", "vertical"):
        raise ValueError("Invalid slice orientation")
    reader = open_radar_reader(file_path)
    try:
        if reader.reader_type == "SIDD":
            return sidd_slice(reader, orientation, index, scaling)
        metadata = reader.get_sicds_as_tuple()[0]
        height, width = int(metadata.ImageData.NumRows), int(metadata.ImageData.NumCols)
        limit, length = (height, width) if orientation == "horizontal" else (width, height)
        if index < 0 or index >= limit:
            raise ValueError("Slice index is outside the image")
        step = max(1, math.ceil(length / 4096))
        rows, columns = ((slice(index, index + 1), slice(0, width, step))
                         if orientation == "horizontal" else
                         (slice(0, height, step), slice(index, index + 1)))
        samples = reader.read(rows, columns, index=0, squeeze=False)
        values = scale_samples(samples, metadata, range(*rows.indices(height)), range(*columns.indices(width)), scaling).reshape(-1)
        return {
            "points": [{"position": int(position), "value": float(value) if np.isfinite(value) else None}
                       for position, value in zip(range(0, length, step), values)],
            "positionLabel": "Column (pixel)" if orientation == "horizontal" else "Row (pixel)",
            "valueLabel": SCALING_LABELS[scaling],
        }
    finally:
        reader.close()


def pixel_image(file_path, row, column, scaling="amplitude", peak_power=None):
    import numpy as np
    reader = open_radar_reader(file_path)
    try:
        if reader.reader_type == "SIDD":
            return sidd_pixel(reader, row, column, scaling)
        metadata = reader.get_sicds_as_tuple()[0]
        if not (0 <= row < metadata.ImageData.NumRows and 0 <= column < metadata.ImageData.NumCols):
            raise ValueError("Pixel is outside the image")
        samples = reader.read(slice(row, row + 1), slice(column, column + 1), index=0, squeeze=False)
        if scaling == "relative-power":
            power = float(np.abs(samples.astype(np.complex128)[0, 0]) ** 2)
            value = 10 * math.log10(power / peak_power) if peak_power is not None and peak_power > 0 and power > 0 else float("nan")
        else:
            value = float(scale_samples(samples, metadata, [row], [column], scaling)[0, 0])
        return {"value": value if math.isfinite(value) else None, "valueLabel": SCALING_LABELS[scaling]}
    finally:
        reader.close()


def main():
    try:
        # Keep library logging away from the stdout JSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            if len(sys.argv) == 7 and sys.argv[2] == "--pixel":
                result = pixel_image(sys.argv[1], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], float(sys.argv[6]))
            elif len(sys.argv) in (5, 6) and sys.argv[2] == "--slice":
                result = slice_image(sys.argv[1], sys.argv[3], int(sys.argv[4]), sys.argv[5] if len(sys.argv) == 6 else "amplitude")
            elif len(sys.argv) == 4 and sys.argv[2] == "--scaling":
                result = render(sys.argv[1], sys.argv[3])
            elif len(sys.argv) == 2:
                result = render(sys.argv[1])
            else:
                raise ValueError("Expected a file or a file with --slice orientation index")
        print(json.dumps(result, allow_nan=False))
        return 0
    except ImportError as error:
        print(f"Missing SICD/SIDD dependency: {error}. Install the plugin's requirements.txt into your configured Python environment.", file=sys.stderr)
    except Exception as error:
        print(f"Unable to read SICD/SIDD: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
