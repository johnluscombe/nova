"""Integration tests using real CPHD signal and per-vector data blocks."""
import importlib.util
import pathlib
import tempfile
import unittest
import numpy as np
from sarpy.io.phase_history.cphd import CPHDWriter1
from sarpy.io.phase_history.cphd1_elements.CPHD import CPHDType

spec = importlib.util.spec_from_file_location("reader", pathlib.Path(__file__).parent / "electron-assets/plugins/scientific-imagery/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class CphdReaderTests(unittest.TestCase):
    @staticmethod
    def fixture(file, data):
        metadata = CPHDType(
            CollectionID={"CollectorName": "Synthetic", "CoreName": "Nova test", "Classification": "UNCLASSIFIED", "ReleaseInfo": "UNRESTRICTED"},
            Global={"DomainType": "FX"},
            Data={"SignalArrayFormat": "CF8", "NumBytesPVP": 8,
                  "Channels": [{"Identifier": "test", "NumVectors": data.shape[0], "NumSamples": data.shape[1], "SignalArrayByteOffset": 0, "PVPArrayByteOffset": 0}]},
            PVP={"TxTime": {"Offset": 0}})
        pvp = np.zeros(data.shape[0], dtype=metadata.PVP.get_vector_dtype())
        with CPHDWriter1(str(file), metadata, check_existence=False) as writer:
            writer.write_file({"test": pvp}, {"test": data})

    def test_preview_scaling_pixels_slices_and_regions(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "signal.cphd"
            data = (np.arange(32).reshape(4, 8) + 2j).astype("complex64")
            self.fixture(file, data)
            result = reader.render(str(file), "real")
            self.assertEqual((result["height"], result["width"]), (4, 8))
            self.assertEqual(result["metadata"]["Format"], "CPHD")
            self.assertEqual(result["metadata"]["Channel"], "test")
            self.assertEqual(result["metadata"]["Domain"], "FX")
            self.assertEqual(result["axes"]["row"]["label"], "Vector")
            self.assertEqual(result["axes"]["column"]["unit"], "pixel")
            self.assertEqual(len(result["scalingOptions"]), 7)
            self.assertEqual(result["statistics"]["100th percentile"], 31)
            self.assertEqual(reader.pixel_image(str(file), 2, 3, "imaginary")["value"], 2)
            self.assertEqual(reader.slice_image(str(file), "horizontal", 2, "real")["points"][3]["value"], 19)
            self.assertEqual(reader.slice_image(str(file), "vertical", 3, "real")["points"][2]["value"], 19)
            polygon = [{"row": 1, "column": 2}, {"row": 1, "column": 4}, {"row": 3, "column": 4}, {"row": 3, "column": 2}]
            region = reader.region_image(str(file), polygon, "real")
            self.assertEqual(region["sampleCount"], 4)
            self.assertEqual(region["statistics"]["50th percentile"], 14.5)
            with self.assertRaises(ValueError):
                reader.render(str(file), "rcs")

    def test_bounded_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "large.cphd"
            self.fixture(file, np.ones((2, 8193), dtype="complex64"))
            self.assertTrue(reader.render(str(file))["previewDataUrl"].startswith("data:image/png;base64,"))
            self.assertLessEqual(len(reader.slice_image(str(file), "horizontal", 0)["points"]), 4096)


if __name__ == "__main__":
    unittest.main()
