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
from types import SimpleNamespace
from unittest.mock import patch
from sarpy.io.complex.sicd_elements.blocks import Poly2DType
from sarpy.io.complex.sicd_elements.Grid import GridType
import numpy as np
from sarpy.io.complex.sicd import SICDWriter, SICDWritingDetails
from sarpy.io.complex.sicd_elements.SICD import SICDType
from sarpy.io.complex.sicd_elements.ImageData import ImageDataType

spec = importlib.util.spec_from_file_location("sicd_reader", pathlib.Path(__file__).parent / "electron-assets/plugins/scientific-imagery/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class SicdPreviewTests(unittest.TestCase):
    def fixture(self, file, data, encoding="RE32F_IM32F", grid=None, row_limit=None):
        height, width = data.shape
        image = ImageDataType(PixelType=encoding, NumRows=height, NumCols=width, FirstRow=0, FirstCol=0,
                              FullImage={"NumRows": height, "NumCols": width}, SCPPixel={"Row": height // 2, "Col": width // 2},
                              AmpTable=np.arange(256, dtype=np.float64) if encoding == "AMP8I_PHS8I" else None)
        metadata = SICDType(ImageData=image, Grid=grid)
        metadata.NITF["FTITLE"] = "Nova synthetic test"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            writer_args = {"sicd_meta": metadata} if row_limit is None else {"sicd_writing_details": SICDWritingDetails(metadata, row_limit=row_limit)}
            with SICDWriter(str(file), check_existence=False, **writer_args) as writer:
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
        result = reader.image_statistics(np.array([0, 2, 4, np.nan, np.inf, -np.inf]))
        expected = {
            "1st percentile": 0.04, "5th percentile": 0.2,
            "25th percentile": 1, "50th percentile": 2,
            "75th percentile": 3, "95th percentile": 3.8,
            "99th percentile": 3.96,
        }
        self.assertEqual(len(result), 101)
        self.assertEqual(result["0th percentile"], 0)
        self.assertEqual(result["100th percentile"], 4)
        for label, value in expected.items():
            self.assertAlmostEqual(result[label], value)
        for values in [np.array([np.nan, np.inf]), np.array([])]:
            self.assertEqual(reader.image_statistics(values), dict.fromkeys(result))
        for value in [0, 7]:
            self.assertEqual(reader.image_statistics(np.full((2, 3), value)),
                             dict.fromkeys(result, value))

    def test_source_slices(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "slice.nitf"
            data = np.arange(12, dtype=np.float32).reshape(3, 4) + 1j
            self.fixture(file, data)
            horizontal = reader.slice_image(str(file), "horizontal", 1)
            vertical = reader.slice_image(str(file), "vertical", 2)
            self.assertEqual([p["position"] for p in horizontal["points"]], [0, 1, 2, 3])
            np.testing.assert_allclose([p["value"] for p in horizontal["points"]], np.abs(data[1]))
            np.testing.assert_allclose([p["value"] for p in vertical["points"]], np.abs(data[:, 2]))
            self.assertEqual(horizontal["valueLabel"], "Source amplitude")
            for orientation, index in [("horizontal", -1), ("horizontal", 3), ("vertical", 4), ("diagonal", 0)]:
                with self.assertRaises(ValueError):
                    reader.slice_image(str(file), orientation, index)

    def test_long_slice_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "long.nitf"
            self.fixture(file, np.ones((2, 8193), dtype="complex64"))
            result = reader.slice_image(str(file), "horizontal", 0)
            self.assertLessEqual(len(result["points"]), 4096)
            self.assertEqual(result["points"][1]["position"], 3)

    def test_scaling_quantities(self):
        metadata = SimpleNamespace()
        samples = np.array([[3 + 4j, -3 - 4j, 0j]])
        def scale(mode):
            return reader.scale_samples(samples, metadata, [0], [0, 1, 2], mode)
        np.testing.assert_allclose(scale("amplitude"), [[5, 5, 0]])
        np.testing.assert_allclose(scale("real"), [[3, -3, 0]])
        np.testing.assert_allclose(scale("imaginary"), [[4, -4, 0]])
        np.testing.assert_allclose(scale("power"), [[25, 25, 0]])
        np.testing.assert_allclose(scale("log-power")[0, :2], [10 * np.log10(25)] * 2)
        np.testing.assert_allclose(scale("relative-power")[0, :2], [0, 0])
        np.testing.assert_allclose(scale("phase")[0, :2], [53.130102354, -126.869897646])
        for mode in ["log-power", "relative-power", "phase"]:
            self.assertTrue(np.isnan(scale(mode)[0, 2]))
        self.assertTrue(np.isnan(reader.scale_samples(np.zeros((1, 1)), metadata, [0], [0], "relative-power")).all())
        for mode in ["rcs", "sigma-zero", "unknown"]:
            with self.assertRaises(ValueError):
                scale(mode)

    def test_radiometric_scaling_uses_scp_coordinates_and_chip_offsets(self):
        # Coordinates are row=(10 + [0,2] - 9)*2 and col=(20 + [0,3,6] - 18)*0.5.
        # A nonconstant polynomial catches swapped axes and omitted chip offsets.
        polynomial = Poly2DType(Coefs=[[1, 3], [2, 0]])
        metadata = SimpleNamespace(
            ImageData=SimpleNamespace(FirstRow=10, FirstCol=20, SCPPixel=SimpleNamespace(Row=9, Col=18)),
            Grid=SimpleNamespace(Row=SimpleNamespace(SS=2), Col=SimpleNamespace(SS=0.5)),
            Radiometric=SimpleNamespace(**{field: polynomial for field in reader.CALIBRATION_FIELDS.values()}))
        samples = np.full((2, 3), 3 + 4j)
        expected = 25 * (1 + 2 * np.array([2, 6])[:, None] + 3 * np.array([1, 2.5, 4])[None, :])
        self.assertEqual(len(reader.scaling_options(metadata)), 15)
        for mode in reader.CALIBRATION_FIELDS:
            np.testing.assert_allclose(reader.scale_samples(samples, metadata, [0, 2], [0, 3, 6], mode), expected)
            np.testing.assert_allclose(reader.scale_samples(samples, metadata, [0, 2], [0, 3, 6], mode + "-db"), 10 * np.log10(expected))
        metadata.Radiometric.RCSSFPoly = Poly2DType(Coefs=[[-1]])
        self.assertTrue(np.isnan(reader.scale_samples(samples, metadata, [0, 2], [0, 3, 6], "rcs")).all())
        metadata.Grid.Row.SS = float("nan")
        self.assertNotIn("rcs", reader.scaling_options(metadata))

    def test_scaled_preview_statistics_and_slices(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "scaled.nitf"
            data = np.array([[3 + 4j, -3 - 4j, 0j], [1j, -1j, 2j]])
            self.fixture(file, data)
            for scaling in list(reader.SCALING_LABELS)[:7]:
                result = reader.render(str(file), scaling)
                self.assertEqual(result["scaling"], scaling)
                self.assertEqual(len(result["scalingOptions"]), 7)
                self.assertEqual(result["metadata"]["Scaling"], reader.SCALING_LABELS[scaling])
                self.assertTrue(result["previewDataUrl"].startswith("data:image/png;base64,"))
            real = reader.render(str(file), "real")
            self.assertEqual(real["statistics"]["0th percentile"], -3)
            self.assertEqual(real["statistics"]["100th percentile"], 3)
            power = reader.slice_image(str(file), "horizontal", 0, "power")
            self.assertEqual([p["value"] for p in power["points"]], [25, 25, 0])
            log_power = reader.slice_image(str(file), "horizontal", 0, "log-power")
            self.assertIsNone(log_power["points"][-1]["value"])
            with self.assertRaises(ValueError):
                reader.render(str(file), "rcs")

    def test_exact_pixel_values_and_relative_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "pixels.nitf"
            data = np.array([[0, 3 + 4j, -3 - 4j], [1j, 10j, 2j]], dtype="complex64")
            self.fixture(file, data)
            expected = {"amplitude": 5, "real": -3, "imaginary": -4, "power": 25,
                        "log-power": 10 * np.log10(25), "phase": -126.86989764584402}
            for mode, value in expected.items():
                result = reader.pixel_image(str(file), 0, 2, mode)
                self.assertAlmostEqual(result["value"], value)
                self.assertEqual(result["valueLabel"], reader.SCALING_LABELS[mode])
            peak = reader.render(str(file))["peakPower"]
            self.assertEqual(peak, 100)
            relative = reader.pixel_image(str(file), 0, 1, "relative-power", peak)
            self.assertAlmostEqual(relative["value"], 10 * np.log10(0.25))
            for mode in ["log-power", "phase", "relative-power"]:
                self.assertIsNone(reader.pixel_image(str(file), 0, 0, mode, peak)["value"])
            self.assertIsNone(reader.pixel_image(str(file), 0, 1, "relative-power", 0)["value"])
            for row, column in [(-1, 0), (0, -1), (2, 0), (0, 3)]:
                with self.assertRaises(ValueError):
                    reader.pixel_image(str(file), row, column)

    def test_axes_use_scene_center_offsets_and_actual_grid_directions(self):
        metadata = SimpleNamespace(
            ImageData=SimpleNamespace(FirstRow=10, FirstCol=20, SCPPixel=SimpleNamespace(Row=9, Col=18)),
            Grid=SimpleNamespace(Type="XRGYCR", Row=SimpleNamespace(SS=2), Col=SimpleNamespace(SS=0.5)))
        self.assertEqual(reader.image_axes(metadata), {
            "row": {"label": "Down-range", "unit": "m", "origin": 2, "spacing": 2},
            "column": {"label": "Cross-range", "unit": "m", "origin": 1, "spacing": 0.5}})
        for kind, labels in [("RGAZIM", ("Down-range", "Cross-range (azimuth)")),
                             ("RGZERO", ("Down-range", "Cross-range (azimuth)")),
                             ("XCTYAT", ("Cross-track", "Along-track")),
                             ("PLANE", ("Row distance", "Column distance"))]:
            metadata.Grid.Type = kind
            axes = reader.image_axes(metadata)
            self.assertEqual((axes["row"]["label"], axes["column"]["label"]), labels)
        metadata.ImageData.FirstRow = 0
        self.assertEqual(reader.image_axes(metadata)["row"]["origin"], -18)
        for spacing in [None, 0, -1, float("nan"), float("inf")]:
            metadata.Grid.Row.SS = spacing
            self.assertIsNone(reader.image_axes(metadata))
        self.assertIsNone(reader.image_axes(SimpleNamespace()))

    def test_render_exposes_physical_axes(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "axes.nitf"
            grid = GridType(ImagePlane="SLANT", Type="XRGYCR", Row={"SS": 2}, Col={"SS": 0.5})
            self.fixture(file, np.ones((4, 8), dtype="complex64"), grid=grid)
            axes = reader.render(str(file))["axes"]
            self.assertEqual(axes["row"], {"label": "Down-range", "unit": "m", "origin": -4, "spacing": 2})
            self.assertEqual(axes["column"], {"label": "Cross-range", "unit": "m", "origin": -2, "spacing": 0.5})
            self.assertEqual(reader.render(str(file), "real")["axes"], axes)

    def test_polygon_statistics_use_source_values_scaling_and_concave_mask(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "region.nitf"
            data = np.arange(12, dtype=np.float32).reshape(3,4) + 1j
            self.fixture(file, data)
            polygon = [{"row":0,"column":0},{"row":0,"column":4},{"row":1,"column":4},{"row":1,"column":1},{"row":3,"column":1},{"row":3,"column":0}]
            result = reader.region_image(str(file),polygon)
            expected = np.abs(data).reshape(-1)[[0,1,2,3,4,8]]
            self.assertEqual(result["sampleCount"],6)
            self.assertFalse(result["sampled"])
            self.assertAlmostEqual(result["statistics"]["50th percentile"],float(np.percentile(expected,50)),places=6)
            real = reader.region_image(str(file),polygon,"real")
            self.assertEqual(real["statistics"]["50th percentile"],2.5)
            pixel = [{"row":0,"column":0},{"row":0,"column":1},{"row":1,"column":1},{"row":1,"column":0}]
            relative = reader.region_image(str(file),pixel,"relative-power",100)
            self.assertAlmostEqual(relative["statistics"]["50th percentile"],-20)
            empty = [{"row":0.1,"column":0.1},{"row":0.1,"column":0.2},{"row":0.2,"column":0.1}]
            self.assertEqual(reader.region_image(str(file),empty)["sampleCount"],0)
            for invalid in (polygon[:2],[{"row":-1,"column":0},*polygon[1:]], [{"row":0,"column":0},{"row":2,"column":2},{"row":0,"column":2},{"row":2,"column":0}]):
                with self.assertRaises(ValueError):
                    reader.region_image(str(file),invalid)

    def test_sampled_polygon_reads_partial_strides_and_segment_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            data = np.arange(35*35,dtype=np.float32).reshape(35,35) + 1j
            polygon = [{"row":5,"column":7},{"row":5,"column":32},{"row":30,"column":32},{"row":30,"column":7}]
            for row_limit in (None, 8):
                with self.subTest(row_limit=row_limit):
                    file=pathlib.Path(directory)/f"sampled-{row_limit}.nitf"
                    self.fixture(file,data,row_limit=row_limit)
                    with patch.object(reader,"MAX_REGION_SAMPLES",9):
                        result=reader.region_image(str(file),polygon)
                    expected=np.abs(data[5:30:9,7:32:9]).astype(np.float64)
                    self.assertTrue(result["sampled"])
                    self.assertEqual(result["sampleCount"],9)
                    self.assertAlmostEqual(result["statistics"]["50th percentile"],float(np.percentile(expected,50)),places=4)
                    self.assertAlmostEqual(result["statistics"]["100th percentile"],float(expected.max()),places=4)

    def test_invalid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "invalid.nitf"
            file.write_text("not a SICD")
            with self.assertRaises(Exception):
                reader.render(str(file))


if __name__ == "__main__":
    unittest.main()
