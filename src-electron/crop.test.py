"""Source-pixel crop tests, including retained scientific coordinates."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import pathlib
import runpy
import tempfile
import unittest
import numpy as np
from PIL import Image
from PIL.TiffImagePlugin import ImageFileDirectory_v2

folder = pathlib.Path(__file__).parent
fixtures = runpy.run_path(str(folder / 'sidd-creation.test.py'))
plugin = folder / 'electron-assets/plugins/scientific-imagery'
modules = []
for name in ('reader', 'crop'):
    spec = importlib.util.spec_from_file_location('test_' + name, plugin / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    modules.append(module)
reader, crop = modules


def selection(left, top, width, height, source_width, source_height):
    return dict(left=left, top=top, width=width, height=height, sourceWidth=source_width, sourceHeight=source_height)


def execute(source, root, rectangle):
    return pathlib.Path(crop.crop_image(str(source), str(root), rectangle, reader.open_image_reader, reader.tiff_decode_guard)['path'])


class CropTests(unittest.TestCase):
    def test_sicd_preserves_complex_values_and_chip_coordinates(self):
        from sarpy.io.complex.sicd import SICDReader
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = fixtures['source_fixture'](root)
            output = execute(source, root, selection(4, 7, 16, 12, 64, 64))
            with SICDReader(str(source)) as original, SICDReader(str(output)) as cropped:
                np.testing.assert_array_equal(cropped.read(squeeze=False), original.read(slice(7, 19), slice(4, 20), squeeze=False))
                self.assertEqual(cropped.sicd_meta.ImageData.FirstRow, original.sicd_meta.ImageData.FirstRow + 7)
                self.assertEqual(cropped.sicd_meta.ImageData.FirstCol, original.sicd_meta.ImageData.FirstCol + 4)
            result = reader.render(str(output))
            self.assertEqual((result['width'], result['height']), (16, 12))
            self.assertIn('scalingOptions', result)

    def test_sidd_preserves_pixels_plane_coordinates_and_time_polynomial(self):
        from sarpy.io.product.sidd import SIDDReader
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = fixtures['source_fixture'](root)
            detected = root / 'source.sidd'
            fixtures['creation'].create_sidd(str(source), str(detected), fixtures['DEFAULT'])
            with SIDDReader(str(detected)) as original:
                height, width = original.get_data_size_as_tuple()[0]
                pixels = original.read(slice(3, 13), slice(2, 14), squeeze=False)
                plane = original.sidd_meta[0].Measurement.PlaneProjection
                point = plane.ReferencePoint.Point.get_array().copy()
                time = plane.TimeCOAPoly(3, 2)
            output = execute(detected, root, selection(2, 3, 12, 10, width, height))
            with SIDDReader(str(output)) as cropped:
                np.testing.assert_array_equal(cropped.read(squeeze=False), pixels)
                plane = cropped.sidd_meta[0].Measurement.PlaneProjection
                np.testing.assert_array_equal(plane.ReferencePoint.Point.get_array(), point - [3, 2])
                self.assertAlmostEqual(plane.TimeCOAPoly(0, 0), time)
            self.assertEqual(reader.render(str(output))['metadata']['Format'], 'SIDD / NITF')

    def test_tiff_preserves_uint16_and_geotiff_tiepoints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / 'source.tiff'
            data = (np.arange(63).reshape(7, 9) * 1000).astype('uint16')
            tags = ImageFileDirectory_v2()
            tags[33550], tags[33922] = (2., 3., 0.), (0., 0., 0., 100., 200., 0.)
            Image.fromarray(data).save(source, tiffinfo=tags)
            output = execute(source, root, selection(3, 2, 4, 3, 9, 7))
            with Image.open(output) as image:
                np.testing.assert_array_equal(np.asarray(image), data[2:5, 3:7])
                self.assertEqual(image.tag_v2[33922], (-3., -2., 0., 100., 200., 0.))
            with self.assertRaises(ValueError):
                execute(source, root, selection(8, 0, 4, 2, 9, 7))


if __name__ == '__main__':
    unittest.main()
