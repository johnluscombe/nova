"""Run with the image plugin Python: python src-electron/tiff-reader.test.py."""
import base64
import importlib.util
import pathlib
import struct
import subprocess
import json
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
import zlib
from unittest.mock import patch
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("image_reader", pathlib.Path(__file__).parent / "electron-assets/plugins/scientific-imagery/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class TiffReaderTests(unittest.TestCase):
    def fixture(self, file, data, compression="raw"):
        Image.fromarray(data).save(file, format="TIFF", compression=compression)

    def test_mono_pixel_types_and_source_values(self):
        with tempfile.TemporaryDirectory() as directory:
            for dtype in ("uint8", "uint16", ">u2", "int32", "float32"):
                with self.subTest(dtype=dtype):
                    file = pathlib.Path(directory) / (dtype.replace(">", "big") + ".tif")
                    data = np.arange(32).reshape(4, 8).astype(dtype)
                    if dtype != "uint8":
                        data = (data * 100).astype(dtype)
                    self.fixture(file, data)
                    result = reader.render(str(file))
                    self.assertEqual((result["width"], result["height"]), (8, 4))
                    self.assertEqual(result["metadata"]["Format"], "TIFF")
                    self.assertNotIn("scalingOptions", result)
                    self.assertEqual(result["statistics"]["100th percentile"], float(data.max()))
                    self.assertEqual(reader.pixel_image(str(file), 2, 3), {"value": float(data[2, 3]), "valueLabel": "Source intensity"})
                    horizontal = reader.slice_image(str(file), "horizontal", 2)
                    vertical = reader.slice_image(str(file), "vertical", 3)
                    self.assertEqual([p["value"] for p in horizontal["points"]], list(map(float, data[2])))
                    self.assertEqual([p["value"] for p in vertical["points"]], list(map(float, data[:, 3])))
                    with self.assertRaises(ValueError):
                        reader.render(str(file), "real")

    def test_rgb_rgba_and_compression_preserve_preview_colors(self):
        with tempfile.TemporaryDirectory() as directory:
            for compression in ("raw", "tiff_lzw", "packbits", "tiff_adobe_deflate"):
                file = pathlib.Path(directory) / (compression + ".tiff")
                data = np.tile(np.array([255, 0, 0], dtype="uint8"), (4, 8, 1))
                self.fixture(file, data, compression)
                result = reader.render(str(file))
                png = base64.b64decode(result["previewDataUrl"].split(",")[1])
                self.assertEqual(png[25], 2)
                length = struct.unpack(">I", png[33:37])[0]
                self.assertEqual(zlib.decompress(png[41:41 + length])[:4], b"\x00\xff\x00\x00")
                self.assertAlmostEqual(reader.pixel_image(str(file), 0, 0)["value"], 54.213)
            rgba = np.tile(np.array([255, 0, 0, 255], dtype="uint8"), (4, 8, 1))
            rgba[0, 0, 3] = 0
            self.fixture(file, rgba)
            result = reader.render(str(file))
            png = base64.b64decode(result["previewDataUrl"].split(",")[1])
            self.assertEqual(png[25], 6)
            self.assertIsNone(reader.pixel_image(str(file), 0, 0)["value"])

    def test_first_page_palette_and_invalid_float_values(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "pages.TIF"
            first, second = Image.new("L", (8, 4), 10), Image.new("L", (8, 4), 200)
            first.save(file, format="TIFF", save_all=True, append_images=[second])
            result = reader.render(str(file))
            self.assertEqual(result["metadata"]["Image selection"], "First of 2 page(s)")
            self.assertEqual(reader.pixel_image(str(file), 0, 0)["value"], 10)
            palette = Image.new("P", (8, 4), 0)
            palette.putpalette([255, 0, 0] + [0] * 765)
            palette.save(file, format="TIFF")
            self.assertAlmostEqual(reader.pixel_image(str(file), 0, 0)["value"], 54.213)
            self.fixture(file, np.array([[np.nan, np.inf, -2, 5]], dtype="float32"))
            self.assertIsNone(reader.pixel_image(str(file), 0, 0)["value"])
            self.assertEqual(reader.render(str(file))["statistics"]["0th percentile"], -2)

    def test_configurable_pixel_limit_and_pillow_guard_restoration(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "limit.tif"
            self.fixture(file, np.ones((4, 8), dtype="uint8"))
            with patch.object(Image, "MAX_IMAGE_PIXELS", 1):
                with self.assertRaisesRegex(ValueError, "TIFF has 32 pixels; maxTiffPixels is 31"):
                    reader.TiffReader(str(file), max_pixels=31)
                self.assertEqual(Image.MAX_IMAGE_PIXELS, 1)
                for limit in (32, 1000, 0):
                    image = reader.TiffReader(str(file), max_pixels=limit)
                    try:
                        self.assertEqual(image.read(slice(0, 4), slice(0, 8)).shape, (4, 8))
                    finally:
                        image.close()
                    self.assertEqual(Image.MAX_IMAGE_PIXELS, 1)
                with patch.object(reader, "MAX_TIFF_PIXELS", 32):
                    self.assertEqual(reader.render(str(file))["width"], 8)
                self.assertEqual(Image.MAX_IMAGE_PIXELS, 1)
                file.write_bytes(b"bad image")
                with self.assertRaises(Exception):
                    reader.TiffReader(str(file), max_pixels=0)
                self.assertEqual(Image.MAX_IMAGE_PIXELS, 1)

    def test_worker_limit_is_applied_to_preview_slice_and_pixel(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "worker.tif"
            self.fixture(file, np.ones((4, 8), dtype="uint8"))
            for args in ([], ["--slice", "horizontal", "0"], ["--pixel", "0", "0", "amplitude", "0"]):
                for limit in (31, 32, 0):
                    result = subprocess.run([sys.executable, reader.__file__, str(file), *args, "--max-tiff-pixels", str(limit)], capture_output=True, text=True)
                    if limit == 31:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("maxTiffPixels is 31", result.stderr)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIsInstance(json.loads(result.stdout), dict)

    def test_bounded_preview_and_invalid_files(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "long.tif"
            self.fixture(file, np.ones((2, 8193), dtype="uint16"))
            result = reader.render(str(file))
            png = base64.b64decode(result["previewDataUrl"].split(",")[1])
            self.assertLessEqual(max(struct.unpack(">II", png[16:24])), 1600)
            self.assertLessEqual(len(reader.slice_image(str(file), "horizontal", 0)["points"]), 4096)
            for operation in (lambda: reader.pixel_image(str(file), -1, 0), lambda: reader.slice_image(str(file), "vertical", 8193)):
                with self.assertRaises(ValueError):
                    operation()
            file.write_bytes(b"not TIFF")
            with self.assertRaises(ValueError):
                reader.render(str(file))


if __name__ == "__main__":
    unittest.main()
