"""Read SICD using SarPy and return a bounded log-magnitude PNG preview as JSON."""
import base64
import contextlib
import json
import math
import struct
import sys
import zlib


def png_grayscale(pixels):
    height, width = pixels.shape
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    scanlines = b"".join(b"\x00" + row.tobytes() for row in pixels)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b"")


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


def image_statistics(magnitude, step):
    import numpy as np
    values = magnitude[np.isfinite(magnitude)].astype(np.float64)
    result = {
        "Basis": "Sampled source amplitude (before display stretch)",
        "Sampling stride (rows / columns)": step,
        "Sample count": int(magnitude.size),
        "Finite samples": int(values.size),
        "Invalid samples": int(magnitude.size - values.size),
    }
    for label in ["Minimum amplitude", "Maximum amplitude", "Mean amplitude", "Median amplitude", "Standard deviation", "RMS amplitude"]:
        result[label] = None
    if values.size:
        result.update({
            "Minimum amplitude": float(values.min()),
            "Maximum amplitude": float(values.max()),
            "Mean amplitude": float(values.mean()),
            "Median amplitude": float(np.median(values)),
            "Standard deviation": float(values.std()),
            "RMS amplitude": float(np.sqrt(np.mean(values * values))),
        })
    return result


def render(file_path):
    import numpy as np
    from sarpy.io.complex.sicd import SICDReader

    with open(file_path, "rb") as source:
        if source.read(9) != b"NITF02.10":
            raise ValueError("SICD requires a NITF 2.1 file")
    reader = SICDReader(file_path)
    try:
        metadata = reader.get_sicds_as_tuple()[0]
        height, width = int(metadata.ImageData.NumRows), int(metadata.ImageData.NumCols)
        if width <= 0 or height <= 0:
            raise ValueError("Invalid SICD dimensions")
        step = max(1, math.ceil(max(width, height) / 1600))
        # Read one sampled row at a time, keeping complex sample memory bounded.
        magnitude = np.empty((math.ceil(height / step), math.ceil(width / step)), dtype=np.float32)
        for output_row, source_row in enumerate(range(0, height, step)):
            samples = reader.read(slice(source_row, source_row + 1), slice(0, width, step), index=0, squeeze=False)
            magnitude[output_row] = np.abs(samples).reshape(-1)
        finite = np.isfinite(magnitude)
        positive = finite & (magnitude > 0)
        pixels = np.zeros(magnitude.shape, dtype=np.uint8)
        if positive.any():
            log_values = np.log1p(magnitude[positive])
            low, high = np.percentile(log_values, [1, 99])
            if high > low:
                scaled = (np.log1p(np.where(positive, magnitude, 0)) - low) / (high - low)
                pixels = np.clip(scaled * 255, 0, 255).astype(np.uint8)
                pixels[~positive] = 0
            else:
                pixels[positive] = 127
        return {"statistics": image_statistics(magnitude, step), "metadata": image_metadata(metadata), "width": width, "height": height, "previewDataUrl": "data:image/png;base64," + base64.b64encode(png_grayscale(pixels)).decode("ascii")}
    finally:
        reader.close()


def main():
    try:
        # Keep library logging away from the stdout JSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            result = render(sys.argv[1])
        print(json.dumps(result, allow_nan=False))
        return 0
    except ImportError as error:
        print(f"Missing SICD dependency: {error}. Install the plugin's requirements.txt into your configured Python environment.", file=sys.stderr)
    except Exception as error:
        print(f"Unable to read SICD: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
