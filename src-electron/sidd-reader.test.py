"""Run with the configured SarPy Python: python src-electron/sidd-reader.test.py."""
import base64
import importlib
import importlib.util
import logging
import pathlib
import struct
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
import warnings
import zlib
from types import SimpleNamespace
import numpy as np
from sarpy.io.product.sidd import SIDDWriter

spec = importlib.util.spec_from_file_location("radar_reader", pathlib.Path(__file__).parent / "electron-assets/plugins/scientific-imagery/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class SiddReaderTests(unittest.TestCase):
    def fixture(self, file, data, encoding="MONO8I", version=2):
        SiddType = importlib.import_module(f"sarpy.io.product.sidd{version}_elements.SIDD").SIDDType
        metadata = SiddType(
            ProductCreation={"ProductName": "Synthetic SIDD", "ProductClass": "Detected Image",
                             "ProcessorInformation": {"Application": "Nova tests", "ProcessingDateTime": "2025-01-01T00:00:00Z", "Site": "Test"},
                             "Classification": {"classification": "U", "ownerProducer": "USA", "createDate": "2025-01-01"}},
            Display={"PixelType": encoding, **({"NumBands": 3 if encoding == "RGB24I" else 1} if version != 1 else {})},
            Measurement={"PixelFootprint": {"Row": data.shape[0], "Col": data.shape[1]}},
            ExploitationFeatures={"Collections": [{"identifier": "test", "Information": {
                "CollectionDateTime": "2025-01-01T00:00:00Z", "SensorName": "Synthetic"}}]})
        # These small synthetic fixtures omit unrelated required schema fields.
        # They exercise actual NITF serialization and SarPy decoding.
        previous = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                with SIDDWriter(str(file), metadata, check_existence=False) as writer:
                    writer.write_chip(data)
        finally:
            logging.disable(previous)

    def test_versions_and_mono_previews(self):
        with tempfile.TemporaryDirectory() as directory:
            for version in (1, 2, 3):
                with self.subTest(version=version):
                    file = pathlib.Path(directory) / f"v{version}.sidd"
                    data = np.arange(32, dtype="uint8").reshape(4, 8)
                    self.fixture(file, data, version=version)
                    result = reader.render(str(file))
                    self.assertEqual((result["width"], result["height"]), (8, 4))
                    self.assertEqual(result["metadata"]["Format"], "SIDD / NITF")
                    self.assertEqual(result["metadata"]["Product"], "Synthetic SIDD")
                    self.assertNotIn("scalingOptions", result)
                    self.assertEqual(result["statistics"]["100th percentile"], 31)
                    png = base64.b64decode(result["previewDataUrl"].split(",")[1])
                    self.assertEqual(struct.unpack(">II", png[16:24]), (8, 4))
                    self.assertEqual(png[25], 0)
                    length = struct.unpack(">I", png[33:37])[0]
                    self.assertEqual(zlib.decompress(png[41:41 + length])[:9], b"\x00" + data[0].tobytes())
                    self.assertEqual(reader.pixel_image(str(file), 2, 3)["value"], 19)

    def test_mono16_rgb_source_slices_and_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            for encoding in ("MONO16I", "RGB24I"):
                with self.subTest(encoding=encoding):
                    file = pathlib.Path(directory) / (encoding + ".nitf")
                    data = (np.arange(32, dtype="uint16").reshape(4, 8) * 1000 if encoding == "MONO16I" else
                            np.tile(np.array([255, 0, 0], dtype="uint8"), (4, 8, 1)))
                    self.fixture(file, data, encoding)
                    result = reader.render(str(file))
                    expected = 31000 if encoding == "MONO16I" else 54.213
                    self.assertAlmostEqual(result["statistics"]["100th percentile"], expected)
                    png = base64.b64decode(result["previewDataUrl"].split(",")[1])
                    self.assertEqual(png[25], 0 if encoding == "MONO16I" else 2)
                    if encoding == "RGB24I":
                        length = struct.unpack(">I", png[33:37])[0]
                        self.assertEqual(zlib.decompress(png[41:41 + length])[:4], b"\x00\xff\x00\x00")
                    row = reader.slice_image(str(file), "horizontal", 2)
                    col = reader.slice_image(str(file), "vertical", 3)
                    pixel = reader.pixel_image(str(file), 2, 3)
                    self.assertEqual(len(row["points"]), 8)
                    self.assertEqual(len(col["points"]), 4)
                    self.assertAlmostEqual(pixel["value"], 19000 if encoding == "MONO16I" else 54.213)
                    self.assertEqual(pixel["valueLabel"], row["valueLabel"])
                    self.assertEqual(pixel["value"], row["points"][3]["value"])
                    polygon=[{"row":1,"column":2},{"row":1,"column":4},{"row":3,"column":4},{"row":3,"column":2}]
                    region=reader.region_image(str(file),polygon)
                    self.assertEqual(region["sampleCount"],4)
                    self.assertAlmostEqual(region["statistics"]["50th percentile"],14500 if encoding == "MONO16I" else 54.213)
                    for operation in (lambda: reader.render(str(file), "real"),
                                      lambda: reader.slice_image(str(file), "horizontal", 0, "power"),
                                      lambda: reader.pixel_image(str(file), 0, 0, "rcs"),
                                      lambda: reader.slice_image(str(file), "vertical", 8),
                                      lambda: reader.pixel_image(str(file), -1, 0)):
                        with self.assertRaises(ValueError):
                            operation()

    def test_bounded_preview_and_slice(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "large.ntf"
            self.fixture(file, np.ones((2, 8193), dtype="uint8"))
            result = reader.render(str(file))
            png = base64.b64decode(result["previewDataUrl"].split(",")[1])
            self.assertLessEqual(max(struct.unpack(">II", png[16:24])), 1600)
            row = reader.slice_image(str(file), "horizontal", 0)
            self.assertLessEqual(len(row["points"]), 4096)
            self.assertEqual(row["points"][1]["position"], 3)

    def test_plane_axes_keep_product_grid_directions(self):
        metadata = SimpleNamespace(Measurement=SimpleNamespace(PlaneProjection=SimpleNamespace(
            SampleSpacing=SimpleNamespace(Row=2, Col=0.5),
            ReferencePoint=SimpleNamespace(Point=SimpleNamespace(Row=10, Col=20)))))
        axes = reader.sidd_axes(metadata)
        self.assertEqual(axes["row"], {"label": "Row distance", "unit": "m", "origin": -20, "spacing": 2})
        self.assertEqual(axes["column"]["origin"], -10)
        self.assertIsNone(reader.sidd_axes(SimpleNamespace()))


if __name__ == "__main__":
    unittest.main()
