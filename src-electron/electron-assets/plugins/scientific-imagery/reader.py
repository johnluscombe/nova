"""Read SICD/SIDD radar imagery and TIFF images using SarPy and Pillow."""
import base64
import contextlib
import json
import math
import struct
import sys
import zlib


def png_preview(pixels):
    height, width = pixels.shape[:2]
    color_type = (6 if pixels.shape[-1] == 4 else 2) if pixels.ndim == 3 else 0
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    scanlines = b"".join(b"\x00" + row.tobytes() for row in pixels)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b"")


MAX_TIFF_PIXELS = 1_000_000_000
MAX_REGION_SAMPLES = 2_560_000

TIFF_SIGNATURES = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")


@contextlib.contextmanager
def tiff_decode_guard():
    from PIL import Image
    previous_limit = Image.MAX_IMAGE_PIXELS
    try:
        Image.MAX_IMAGE_PIXELS = None
        yield
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


class TiffReader:
    reader_type = "TIFF"

    def __init__(self, file_path, max_pixels=None):
        from PIL import Image
        limit = MAX_TIFF_PIXELS if max_pixels is None else max_pixels
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 0:
            raise ValueError("maxTiffPixels must be a nonnegative integer")
        # Read the TIFF header before applying our explicit per-plugin limit.
        # Restore Pillow's global guard before any other image can be opened.
        with tiff_decode_guard():
            self.image = Image.open(file_path)
        pixels = self.image.width * self.image.height
        if limit and pixels > limit:
            self.image.close()
            raise ValueError(f"TIFF has {pixels:,} pixels; maxTiffPixels is {limit:,}. Raise parameters.maxTiffPixels in plugin.json (0 disables the limit).")
        if self.image.format != "TIFF":
            self.image.close()
            raise ValueError("Expected a TIFF image")
        self.image.seek(0)

    def get_data_size_as_tuple(self):
        return ((self.image.height, self.image.width),)

    def read(self, rows, columns, index=0, squeeze=False):
        import numpy as np
        row_start, row_stop, row_step = rows.indices(self.image.height)
        col_start, col_stop, col_step = columns.indices(self.image.width)
        with tiff_decode_guard(), self.image.crop((col_start, row_start, col_stop, row_stop)) as chip:
            mode = "RGBA" if chip.mode == "P" and "transparency" in self.image.info else "RGB"
            if chip.mode in ("P", "CMYK", "YCbCr", "RGBX"):
                chip = chip.convert(mode)
            elif chip.mode == "1":
                chip = chip.convert("L")
            elif chip.mode == "LA":
                chip = chip.convert("RGBA")
            elif chip.mode not in ("L", "RGB", "RGBA", "I", "F", "I;16", "I;16B", "I;16L"):
                raise ValueError(f"Unsupported TIFF pixel mode: {chip.mode}")
            return np.array(chip)[::row_step, ::col_step]

    def metadata(self):
        with tiff_decode_guard():
            result = {"Format": "TIFF", "Pixel type": self.image.mode,
                      "Image selection": f"First of {getattr(self.image, 'n_frames', 1)} page(s)"}
            for label, tag in (("Compression", 259), ("Bits per sample", 258), ("Description", 270), ("Software", 305), ("Date/time", 306)):
                value = self.image.tag_v2.get(tag)
                if value is not None:
                    result[label] = str(value)[:10000]
            return result

    def close(self):
        self.image.close()


def open_image_reader(file_path):
    with open(file_path, "rb") as source:
        if source.read(4) in TIFF_SIGNATURES:
            return TiffReader(file_path)
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


def derived_values(samples, kind="SIDD"):
    import numpy as np
    if samples.ndim == 2:
        return samples.astype(np.float64), ("Source intensity" if kind == "TIFF" else "Derived image intensity")
    if samples.ndim == 3 and samples.shape[-1] == 1:
        return samples[..., 0].astype(np.float64), ("Source intensity" if kind == "TIFF" else "Derived image intensity")
    if samples.ndim == 3 and samples.shape[-1] in (3, 4):
        values = samples[..., :3].astype(np.float64) @ np.array([0.2126, 0.7152, 0.0722])
        if samples.shape[-1] == 4:
            values = np.where(samples[..., 3] == 0, np.nan, values)
        return values, "Source RGB luminance (0–255)"
    raise ValueError("Unsupported derived image bands")


def render_derived(reader):
    import numpy as np
    metadata = reader.get_sidds_as_tuple()[0] if reader.reader_type == "SIDD" else None
    height, width = reader.get_data_size_as_tuple()[0][:2]
    if width <= 0 or height <= 0:
        raise ValueError("Invalid derived image dimensions")
    step = max(1, math.ceil(max(width, height) / 1600))
    # Read one sampled row at a time, preserving RGB channels and bounding memory.
    preview = None
    for out_row, row in enumerate(range(0, height, step)):
        samples = reader.read(slice(row, row + 1), slice(0, width, step), index=0, squeeze=False)
        if preview is None:
            preview = np.empty((math.ceil(height / step),) + samples.shape[1:], dtype=samples.dtype)
        preview[out_row] = samples[0]
    values, value_label = derived_values(preview, reader.reader_type)
    info = sidd_metadata(metadata) if metadata is not None else reader.metadata()
    info["Statistics quantity"] = value_label
    if metadata is not None:
        info["Image selection"] = f"First of {len(reader.get_sidds_as_tuple())} derived image(s)"
    if preview.dtype == np.uint8:
        pixels = preview[..., 0] if preview.ndim == 3 and preview.shape[-1] == 1 else preview
        info["Preview"] = "Display values (no additional stretch)"
    else:
        finite = np.isfinite(values)
        pixels = np.zeros(values.shape, dtype=np.uint8)
        if finite.any():
            low, high = np.percentile(values[finite], [1, 99])
            if high > low:
                pixels = np.clip(np.where(finite, (values - low) / (high - low), 0) * 255, 0, 255).astype(np.uint8)
            else:
                pixels[finite] = 127
        info["Preview"] = "Intensity, 1st–99th percentile stretch"
    axes = sidd_axes(metadata)
    return {"width": int(width), "height": int(height), "metadata": info,
            "statistics": image_statistics(values), **({"axes": axes} if axes else {}),
            "previewDataUrl": "data:image/png;base64," + base64.b64encode(png_preview(pixels)).decode("ascii")}


def derived_slice(reader, orientation, index, scaling):
    import numpy as np
    if scaling != "amplitude":
        raise ValueError("Derived image pixels do not support complex scaling")
    height, width = reader.get_data_size_as_tuple()[0][:2]
    horizontal = orientation == "horizontal"
    limit, length = (height, width) if horizontal else (width, height)
    if not 0 <= index < limit:
        raise ValueError("Slice index is outside the image")
    step = max(1, math.ceil(length / 4096))
    rows, columns = ((slice(index, index + 1), slice(0, width, step)) if horizontal else
                     (slice(0, height, step), slice(index, index + 1)))
    values, label = derived_values(reader.read(rows, columns, index=0, squeeze=False), reader.reader_type)
    return {"points": [{"position": position, "value": float(value) if np.isfinite(value) else None}
                       for position, value in zip(range(0, length, step), values.reshape(-1))],
            "positionLabel": "Column (pixel)" if horizontal else "Row (pixel)", "valueLabel": label}


def derived_pixel(reader, row, column, scaling):
    import numpy as np
    if scaling != "amplitude":
        raise ValueError("Derived image pixels do not support complex scaling")
    height, width = reader.get_data_size_as_tuple()[0][:2]
    if not (0 <= row < height and 0 <= column < width):
        raise ValueError("Pixel is outside the image")
    values, label = derived_values(reader.read(slice(row, row + 1), slice(column, column + 1), index=0, squeeze=False), reader.reader_type)
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
        header = source.read(9)
        if header != b"NITF02.10" and header[:4] not in TIFF_SIGNATURES:
            raise ValueError("Expected a SICD/SIDD NITF 2.1 file or a TIFF image")
    reader = open_image_reader(file_path)
    try:
        if reader.reader_type in ("SIDD", "TIFF"):
            if scaling != "amplitude":
                raise ValueError("Derived image pixels do not support complex scaling")
            return render_derived(reader)
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
    reader = open_image_reader(file_path)
    try:
        if reader.reader_type in ("SIDD", "TIFF"):
            return derived_slice(reader, orientation, index, scaling)
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
    reader = open_image_reader(file_path)
    try:
        if reader.reader_type in ("SIDD", "TIFF"):
            return derived_pixel(reader, row, column, scaling)
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


def validate_polygon(polygon, width, height):
    if not isinstance(polygon, list) or not 3 <= len(polygon) <= 256:
        raise ValueError("A polygon needs 3–256 vertices")
    for point in polygon:
        if not isinstance(point, dict):
            raise ValueError("Invalid polygon vertex")
        for key, limit in (("row", height), ("column", width)):
            value = point.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= limit:
                raise ValueError("Polygon vertices must be inside the image")
    def cross(a, b, c):
        return (b["column"]-a["column"])*(c["row"]-a["row"]) - (b["row"]-a["row"])*(c["column"]-a["column"])
    def on_segment(a, b, p):
        return abs(cross(a,b,p)) < 1e-8 and min(a["row"],b["row"]) <= p["row"] <= max(a["row"],b["row"]) and min(a["column"],b["column"]) <= p["column"] <= max(a["column"],b["column"])
    area = 0
    for i, a in enumerate(polygon):
        b = polygon[(i+1) % len(polygon)]
        if a == b:
            raise ValueError("Polygon vertices must be distinct")
        area += a["column"]*b["row"] - b["column"]*a["row"]
        for j in range(i+1, len(polygon)):
            if j == i+1 or (i == 0 and j == len(polygon)-1):
                continue
            c, d = polygon[j], polygon[(j+1) % len(polygon)]
            if (((cross(a,b,c)>0) != (cross(a,b,d)>0) and (cross(c,d,a)>0) != (cross(c,d,b)>0)) or
                    any((on_segment(a,b,c), on_segment(a,b,d), on_segment(c,d,a), on_segment(c,d,b)))):
                raise ValueError("Polygon edges must not cross")
    if abs(area) < 1e-8:
        raise ValueError("Polygon must enclose an area")


def polygon_row_mask(row, columns, polygon):
    import numpy as np
    x = columns + 0.5
    y = row + 0.5
    inside = np.zeros(x.shape, dtype=bool)
    boundary = np.zeros(x.shape, dtype=bool)
    for i, a in enumerate(polygon):
        b = polygon[(i+1) % len(polygon)]
        ax, ay, bx, by = a["column"], a["row"], b["column"], b["row"]
        cross = (bx-ax)*(y-ay) - (by-ay)*(x-ax)
        boundary |= (np.abs(cross) < 1e-8) & (x >= min(ax,bx)) & (x <= max(ax,bx)) & (y >= min(ay,by)) & (y <= max(ay,by))
        if (ay > y) != (by > y):
            inside ^= x < (bx-ax)*(y-ay)/(by-ay)+ax
    return inside | boundary


def region_image(file_path, polygon, scaling="amplitude", peak_power=0):
    import numpy as np
    reader = open_image_reader(file_path)
    try:
        derived = reader.reader_type in ("SIDD", "TIFF")
        metadata = None if derived else reader.get_sicds_as_tuple()[0]
        height, width = reader.get_data_size_as_tuple()[0][:2] if derived else (int(metadata.ImageData.NumRows), int(metadata.ImageData.NumCols))
        validate_polygon(polygon, width, height)
        if derived and scaling != "amplitude":
            raise ValueError("Derived image pixels do not support complex scaling")
        if not derived and scaling not in scaling_options(metadata):
            raise ValueError("Scaling is unavailable for this image")
        top = max(0, math.floor(min(p["row"] for p in polygon)))
        bottom = min(height, math.ceil(max(p["row"] for p in polygon)))
        left = max(0, math.floor(min(p["column"] for p in polygon)))
        right = min(width, math.ceil(max(p["column"] for p in polygon)))
        row_span, col_span = bottom-top, right-left
        step = max(1, math.ceil(math.sqrt(row_span*col_span/MAX_REGION_SAMPLES)))
        while math.ceil(row_span/step)*math.ceil(col_span/step) > MAX_REGION_SAMPLES:
            count = math.ceil(row_span/step)*math.ceil(col_span/step)
            step = max(step+1, math.ceil(step*math.sqrt(count/MAX_REGION_SAMPLES)))
        columns = np.arange(left, right, step)
        selected = []
        if derived:
            mode = reader.image.mode if reader.reader_type == "TIFF" else reader.get_sidds_as_tuple()[0].Display.PixelType
            label = "Source RGB luminance (0–255)" if mode in ("RGB", "RGBA", "P", "CMYK", "YCbCr", "RGBX", "LA") or "RGB" in mode else ("Source intensity" if reader.reader_type == "TIFF" else "Derived image intensity")
        else:
            label = SCALING_LABELS[scaling]
        block_rows = 64 if step == 1 else 1
        for row in range(top, bottom, step*block_rows):
            stop = min(bottom, row+step*block_rows)
            rows = np.arange(row, stop, step)
            mask = np.stack([polygon_row_mask(int(r), columns, polygon) for r in rows])
            if not mask.any():
                continue
            # SarPy's segmented readers can turn a strided intersection into
            # an empty slice when a segment contains no sampled pixel. Keep
            # source reads contiguous; apply the identical stride in NumPy.
            read_stop = row+1 if step > 1 else stop
            samples = reader.read(slice(row,read_stop), slice(left,right), index=0, squeeze=False)[:, ::step]
            if derived:
                values, label = derived_values(samples, reader.reader_type)
            elif scaling == "relative-power":
                power = scale_samples(samples, metadata, rows, columns, "power")
                with np.errstate(divide="ignore", invalid="ignore"):
                    values = np.where(power > 0, 10*np.log10(power/peak_power), np.nan) if peak_power > 0 else np.full(power.shape,np.nan)
            else:
                values = scale_samples(samples, metadata, rows, columns, scaling)
            values = values[mask]
            selected.append(values[np.isfinite(values)])
        values = np.concatenate(selected) if selected else np.array([],dtype=np.float64)
        return {"statistics": image_statistics(values), "valueLabel": label,
                "sampleCount": int(values.size), "sampled": step > 1}
    finally:
        reader.close()


def main():
    global MAX_TIFF_PIXELS
    try:
        argv = sys.argv
        if len(argv) >= 3 and argv[-2] == "--max-tiff-pixels":
            limit = int(argv[-1])
            if limit < 0:
                raise ValueError("maxTiffPixels must be a nonnegative integer")
            MAX_TIFF_PIXELS = limit
            argv = argv[:-2]
        # Keep library logging away from the stdout JSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            if len(argv) == 6 and argv[2] == "--region":
                result = region_image(argv[1], json.loads(argv[3]), argv[4], float(argv[5]))
            elif len(argv) == 7 and argv[2] == "--pixel":
                result = pixel_image(argv[1], int(argv[3]), int(argv[4]), argv[5], float(argv[6]))
            elif len(argv) in (5, 6) and argv[2] == "--slice":
                result = slice_image(argv[1], argv[3], int(argv[4]), argv[5] if len(argv) == 6 else "amplitude")
            elif len(argv) == 4 and argv[2] == "--scaling":
                result = render(argv[1], argv[3])
            elif len(argv) == 2:
                result = render(argv[1])
            else:
                raise ValueError("Expected a file or a file with --slice orientation index")
        print(json.dumps(result, allow_nan=False))
        return 0
    except ImportError as error:
        print(f"Missing image dependency: {error}. Install the plugin's requirements.txt into your configured Python environment.", file=sys.stderr)
    except Exception as error:
        print(f"Scientific Imagery could not read the image: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
