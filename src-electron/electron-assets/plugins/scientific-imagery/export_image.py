"""Export full-resolution display rasters without inventing scientific metadata."""

import math
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image

FORMATS = {
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".tif": "TIFF",
    ".tiff": "TIFF",
    ".bmp": "BMP",
    ".webp": "WEBP",
}


def write_raster(image, output):
    """Encode the requested container, compositing transparency onto white for JPEG."""
    kind = FORMATS.get(Path(output).suffix.lower())
    if kind is None:
        raise ValueError("Unsupported raster export format")
    if kind in ("JPEG", "BMP") and image.mode not in ("RGB", "L"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", image.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    options = (
        {"quality": 95}
        if kind == "JPEG"
        else {"lossless": True}
        if kind == "WEBP"
        else {}
    )
    image.save(output, format=kind, **options)


def export_image(source, output, scaling, worker, color_scale=None):
    """Export the first image/channel at source resolution using preview display mapping.

    Scientific values are mapped to 8-bit display pixels; this is a visual export,
    not a replacement for the calibrated/complex source. The bounded sample grid
    determines a single contrast stretch for all output rows. A disk-backed output
    buffer avoids allocating a full complex image in memory.
    """
    with open(source, "rb") as stream:
        header = stream.read(9)
    scientific = (
        header == b"NITF02.10"
        or header[:4] == b"CPHD"
        or header[:4] in worker.TIFF_SIGNATURES
    )
    if not scientific:
        with Image.open(source) as image:
            image.load()
            if color_scale is not None:
                from color_scale import validate_scale, apply_colors

                validate_scale(color_scale)
                low = (
                    color_scale["minimum"] if color_scale["minimum"] is not None else 0
                )
                high = (
                    color_scale["maximum"]
                    if color_scale["maximum"] is not None
                    else 255
                )
                if low >= high:
                    raise ValueError("Color scale minimum must be below maximum")
                rgba = np.array(image.convert("RGBA"))
                luminance = rgba[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
                rgba[..., :3] = apply_colors(luminance, color_scale, (low, high))
                image = Image.fromarray(rgba)
            write_raster(image, output)
        return {}

    reader = worker.open_image_reader(str(source))
    try:
        height, width = reader.get_data_size_as_tuple()[0][:2]
        derived = reader.reader_type in ("SIDD", "TIFF")
        metadata = None if derived else worker.complex_metadata(reader)
        step = max(1, math.ceil(max(height, width) / 1600))
        sampled = []
        for row in range(0, height, step):
            samples = reader.read(
                slice(row, row + 1), slice(0, width, step), index=0, squeeze=False
            )
            sampled.append(samples[0])
        preview = np.stack(sampled)
        preserve = derived and preview.dtype == np.uint8
        peak = None
        if not derived:
            peak_values = np.abs(preview.astype(np.complex128)) ** 2
            finite_power = peak_values[np.isfinite(peak_values) & (peak_values > 0)]
            peak = float(finite_power.max()) if finite_power.size else None

        def values(samples, rows, columns):
            """Map a source block into the selected display quantity using a fixed peak."""
            if derived:
                return worker.derived_values(samples, reader.reader_type)[0]
            if scaling == "relative-power":
                power = np.abs(samples.astype(np.complex128)) ** 2
                with np.errstate(divide="ignore", invalid="ignore"):
                    return (
                        np.where(
                            (power > 0) & np.isfinite(power),
                            10 * np.log10(power / peak),
                            np.nan,
                        )
                        if peak
                        else np.full(power.shape, np.nan)
                    )
            result = worker.scale_samples(samples, metadata, rows, columns, scaling)
            return (
                np.log1p(result)
                if scaling == "amplitude" and color_scale is None
                else result
            )

        reference = values(preview, range(0, height, step), range(0, width, step))
        finite = np.isfinite(reference) & (
            reference > 0 if not derived and scaling == "amplitude" else True
        )
        low, high = (
            np.percentile(reference[finite], [1, 99]) if finite.any() else (0, 0)
        )
        color_limits = None
        if color_scale is not None:
            from color_scale import color_bounds, apply_colors

            color_limits = color_bounds(
                reference, color_scale, not derived and scaling == "amplitude"
            )
        channels = (
            (3,) if color_scale is not None else preview.shape[2:] if preserve else ()
        )
        if channels == (1,):
            channels = ()
        with tempfile.TemporaryFile() as buffer:
            pixels = np.memmap(
                buffer, dtype=np.uint8, mode="w+", shape=(height, width) + channels
            )
            for row in range(height):
                samples = reader.read(
                    slice(row, row + 1), slice(0, width), index=0, squeeze=False
                )
                if color_scale is not None:
                    data = values(samples, [row], range(width))[0]
                    pixels[row] = apply_colors(
                        data,
                        color_scale,
                        color_limits,
                        not derived and scaling == "amplitude",
                    )
                elif preserve:
                    data = samples[0]
                    pixels[row] = (
                        data[..., 0] if data.ndim == 2 and data.shape[-1] == 1 else data
                    )
                else:
                    data = values(samples, [row], range(width))[0]
                    valid = np.isfinite(data) & (
                        data > 0 if not derived and scaling == "amplitude" else True
                    )
                    if high > low:
                        mapped = np.where(valid, (data - low) / (high - low), 0)
                        pixels[row] = (np.clip(mapped, 0, 1) * 255).astype(np.uint8)
                    else:
                        pixels[row] = np.where(valid, 127, 0).astype(np.uint8)
            image = Image.fromarray(pixels)
            try:
                write_raster(image, output)
            finally:
                image.close()
                del pixels
        return {}
    finally:
        reader.close()
