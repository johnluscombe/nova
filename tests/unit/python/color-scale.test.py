"""Color mapping and full-resolution scientific export regression tests."""

from pathlib import Path
import runpy
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image

plugin = (
    Path(__file__).resolve().parents[3]
    / "src-electron/electron-assets/plugins/scientific-imagery"
)
sys.path.insert(0, str(plugin))
import color_scale
import export_image

fixtures = runpy.run_path(str(Path(__file__).parent / "sicd-reader.test.py"))
worker = fixtures["reader"]


class ColorScaleTests(unittest.TestCase):
    def test_limits_interpolation_and_invalid_values(self):
        """Clip finite values and leave invalid data black without changing input."""
        scale = dict(minimum=0, maximum=100, colors=["#0000ff", "#ff0000"])
        values = np.array([[-1, 0, 50, 100, 101, np.nan]])
        result = color_scale.colorize(values, scale)
        np.testing.assert_array_equal(
            result[0],
            [
                [0, 0, 255],
                [0, 0, 255],
                [128, 0, 128],
                [255, 0, 0],
                [255, 0, 0],
                [0, 0, 0],
            ],
        )
        self.assertTrue(np.isnan(values[0, -1]))
        for invalid in [
            dict(scale, minimum=100),
            dict(scale, colors=["red", "blue"]),
            dict(scale, minimum=float("inf")),
        ]:
            with self.assertRaises(ValueError):
                color_scale.validate_scale(invalid)
        with self.assertRaises(ValueError):
            color_scale.colorize(values, dict(scale, minimum=-1), True)

    def test_source_unit_limits_match_preview_and_export(self):
        """Use amplitude units for controls despite logarithmic display mapping."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sicd"
            output = Path(directory) / "colored.png"
            scale = dict(minimum=0, maximum=100, colors=["#0000ff", "#ff0000"])
            data = np.array([[0, 10, 100], [1, 20, 200]], dtype=np.complex64)
            fixtures["SicdPreviewTests"]().fixture(source, data)
            original = worker.render(str(source))
            colored = worker.render(str(source), "amplitude", scale)
            self.assertEqual(original["statistics"], colored["statistics"])
            export_image.export_image(str(source), output, "amplitude", worker, scale)
            with Image.open(output) as result:
                self.assertEqual(result.size, (3, 2))
                self.assertEqual(result.getpixel((0, 0)), (0, 0, 255))
                self.assertEqual(result.getpixel((2, 0)), (255, 0, 0))
                expected = color_scale.colorize(np.abs(data), scale, True)
                np.testing.assert_array_equal(np.array(result), expected)

    def test_standard_luminance_export(self):
        """Use the same 0–255 luminance convention for ordinary raster exports."""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "colored.webp"
            Image.new("RGBA", (2, 2), (128, 128, 128, 128)).save(source)
            scale = dict(minimum=64, maximum=192, colors=["#0000ff", "#ff0000"])
            export_image.export_image(source, output, "amplitude", worker, scale)
            with Image.open(output) as result:
                self.assertEqual(result.getpixel((0, 0)), (128, 0, 128, 128))


if __name__ == "__main__":
    unittest.main()
