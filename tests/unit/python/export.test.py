"""Verify source-resolution raster exports and actual output encodings."""

import importlib.util
from pathlib import Path
import runpy
import tempfile
import unittest

import numpy as np
from PIL import Image

folder = Path(__file__).parent
fixtures = runpy.run_path(str(folder / "sicd-reader.test.py"))
sidd_fixtures = runpy.run_path(str(folder / "sidd-reader.test.py"))
worker = fixtures["reader"]
spec = importlib.util.spec_from_file_location(
    "export_image",
    Path(__file__).resolve().parents[3]
    / "src-electron/electron-assets/plugins/scientific-imagery/export_image.py",
)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def test_encodings_and_alpha(self):
        """Write real output containers and flatten JPEG transparency onto white."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            Image.new("RGBA", (8, 6), (255, 0, 0, 0)).save(source)
            before = source.read_bytes()
            for suffix, kind in exporter.FORMATS.items():
                output = Path(directory) / f"output{suffix}"
                exporter.export_image(source, output, "amplitude", worker)
                with Image.open(output) as result:
                    self.assertEqual(result.format, kind)
                    self.assertEqual(result.size, (8, 6))
                    if kind == "JPEG":
                        self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
            self.assertEqual(source.read_bytes(), before)

    def test_sicd_exports_source_dimensions_and_scaling(self):
        """Export beyond preview resolution with distinct complex scaling modes."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sicd"
            real = np.linspace(-100, 100, 1700 * 4).reshape(1700, 4)
            data = (real + 20j).astype(np.complex64)
            fixtures["SicdPreviewTests"]().fixture(source, data)
            before = source.read_bytes()
            pixels = []
            for scaling in ("amplitude", "real", "relative-power"):
                output = Path(directory) / f"{scaling}.png"
                exporter.export_image(source, output, scaling, worker)
                with Image.open(output) as result:
                    self.assertEqual(result.size, (4, 1700))
                    pixels.append(np.array(result))
            self.assertFalse(np.array_equal(pixels[0], pixels[1]))
            self.assertEqual(source.read_bytes(), before)

    def test_sidd_and_rgb_tiff(self):
        """Export SIDD intensity and preserve TIFF RGB colors at source resolution."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sidd"
            output = Path(directory) / "derived.png"
            sidd_fixtures["SiddReaderTests"]().fixture(
                source, np.arange(32, dtype=np.uint8).reshape(4, 8), "MONO8I"
            )
            exporter.export_image(source, output, "amplitude", worker)
            with Image.open(output) as result:
                np.testing.assert_array_equal(
                    np.array(result), np.arange(32).reshape(4, 8)
                )
            tiff = Path(directory) / "source.tif"
            Image.new("RGB", (8, 6), (5, 100, 220)).save(tiff)
            exporter.export_image(tiff, output, "amplitude", worker)
            with Image.open(output) as result:
                self.assertEqual(result.getpixel((0, 0)), (5, 100, 220))


if __name__ == "__main__":
    unittest.main()
