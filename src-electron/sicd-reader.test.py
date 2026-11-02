"""Run with the configured SICD Python: python src-electron/sicd-reader.test.py."""
import base64
import importlib.util
import pathlib
import struct
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
import warnings
import zlib
import numpy as np
from sarpy.io.complex.sicd import SICDWriter
from sarpy.io.complex.sicd_elements.SICD import SICDType
from sarpy.io.complex.sicd_elements.ImageData import ImageDataType

spec = importlib.util.spec_from_file_location("sicd_reader", pathlib.Path(__file__).parent / "electron-assets/plugins/sicd/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class SicdPreviewTests(unittest.TestCase):
    def fixture(self, file, data, encoding="RE32F_IM32F"):
        height, width = data.shape
        image = ImageDataType(PixelType=encoding, NumRows=height, NumCols=width, FirstRow=0, FirstCol=0,
                              FullImage={"NumRows": height, "NumCols": width}, SCPPixel={"Row": height // 2, "Col": width // 2},
                              AmpTable=np.arange(256, dtype=np.float64) if encoding == "AMP8I_PHS8I" else None)
        metadata = SICDType(ImageData=image)
        metadata.NITF["FTITLE"] = "Nova synthetic test"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            with SICDWriter(str(file), metadata, check_existence=False) as writer:
                if encoding == "AMP8I_PHS8I":
                    # Avoid SarPy's AMP8 inverse-write broadcasting bug; write valid
                    # interleaved amplitude/phase samples directly to the fixture.
                    raw = np.stack([np.real(data).astype("uint8"), np.zeros(data.shape, dtype="uint8")], axis=-1)
                    writer.write_raw(raw)
                else:
                    writer.write_chip(data.astype("complex64"))

    def test_pixel_encodings(self):
        with tempfile.TemporaryDirectory() as directory:
            for encoding in ["RE32F_IM32F", "RE16I_IM16I", "AMP8I_PHS8I"]:
                with self.subTest(encoding=encoding):
                    file = pathlib.Path(directory) / (encoding + ".nitf")
                    data = (np.arange(32 * 48).reshape(32, 48) % 100) + 1j
                    self.fixture(file, data, encoding)
                    result = reader.render(str(file))
                    self.assertEqual((result["width"], result["height"]), (48, 32))
                    self.assertEqual(result["metadata"]["Pixel type"], encoding)
                    self.assertEqual(result["metadata"]["Format"], "SICD / NITF")
                    png = base64.b64decode(result["previewDataUrl"].split(",")[1])
                    self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
                    self.assertEqual(struct.unpack(">II", png[16:24]), (48, 32))
                    length = struct.unpack(">I", png[33:37])[0]
                    scanlines = zlib.decompress(png[41:41 + length])
                    self.assertGreater(max(scanlines), min(scanlines))

    def test_bounded_preview_and_constant_data(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "large.nitf"
            self.fixture(file, np.ones((4, 3201), dtype="complex64"))
            result = reader.render(str(file))
            png = base64.b64decode(result["previewDataUrl"].split(",")[1])
            self.assertEqual((result["width"], result["height"]), (3201, 4))
            self.assertEqual(struct.unpack(">II", png[16:24]), (1067, 2))

    def test_statistics(self):
        result = reader.image_statistics(np.array([0, 2, 4, np.nan, np.inf]), 3)
        self.assertEqual(result["Sampling stride (rows / columns)"], 3)
        self.assertEqual(result["Sample count"], 5)
        self.assertEqual(result["Invalid samples"], 2)
        self.assertEqual(result["Minimum amplitude"], 0)
        self.assertEqual(result["Maximum amplitude"], 4)
        self.assertEqual(result["Mean amplitude"], 2)
        self.assertEqual(result["Median amplitude"], 2)
        self.assertAlmostEqual(result["Standard deviation"], np.std([0, 2, 4]))
        self.assertAlmostEqual(result["RMS amplitude"], np.sqrt(20 / 3))
        self.assertIsNone(reader.image_statistics(np.array([np.nan]), 1)["Mean amplitude"])

    def test_invalid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "invalid.nitf"
            file.write_text("not a SICD")
            with self.assertRaises(Exception):
                reader.render(str(file))


if __name__ == "__main__":
    unittest.main()
