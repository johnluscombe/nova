"""SICD-to-SIDD tests using actual NITF products and projection metadata."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import pathlib
import runpy
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from sarpy.io.product.sidd import SIDDReader

folder = pathlib.Path(__file__).parent
fixtures = runpy.run_path(str(folder / 'formation.test.py'))
spec = importlib.util.spec_from_file_location('sidd_creation', folder / 'electron-assets/plugins/scientific-imagery/sidd_creation.py')
creation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(creation)
DEFAULT = dict(version=3, bitDepth=8, contrast='density', interpolation='nearest', pixelSpacing=0)


def source_fixture(directory):
    source = directory / 'source.sicd'
    fixtures['FormationTests'].fixture(directory / 'source.cphd')
    fixtures['formation'].form_sicd(str(directory / 'source.cphd'), str(source),
        dict(algorithm='backprojection', imageSize=64, pixelSpacing=.5, maxVectors=64, window='uniform'))
    return source


class SiddCreationTests(unittest.TestCase):
    def test_versions_bit_depths_and_display_methods(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = source_fixture(root)
            for version, bits, contrast, interpolation in ((2, 8, 'density', 'nearest'), (3, 16, 'linear', 'bilinear'), (3, 8, 'logarithmic', 'nearest')):
                with self.subTest(version=version, bits=bits, contrast=contrast):
                    output = root / f'detected-{version}-{bits}-{contrast}.sidd'
                    settings = {**DEFAULT, 'version': version, 'bitDepth': bits, 'contrast': contrast, 'interpolation': interpolation}
                    creation.create_sidd(str(source), str(output), settings)
                    with SIDDReader(str(output)) as product:
                        data = product.read(squeeze=False)
                        self.assertGreater(data.shape[0], 2)
                        self.assertGreater(data.max(), 0)
                        self.assertEqual(data.dtype.kind, 'u')
                        self.assertEqual(data.dtype.itemsize, bits // 8)
                        self.assertEqual(product.sidd_meta[0].Display.PixelType, f'MONO{bits}I')
                        self.assertEqual(product.sidd_meta[0].ProductCreation.Classification.classification, 'U')
                    previous = output.read_bytes()
                    with self.assertRaisesRegex(ValueError, 'new .sidd'):
                        creation.create_sidd(str(source), str(output), settings)
                    self.assertEqual(previous, output.read_bytes())

    def test_linear_bit_depths_preserve_the_same_display_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = source_fixture(root)
            arrays = []
            for bits in (8, 16):
                output = root / f'linear-{bits}.sidd'
                creation.create_sidd(str(source), str(output), {**DEFAULT, 'bitDepth': bits, 'contrast': 'linear'})
                with SIDDReader(str(output)) as product:
                    arrays.append(product.read(squeeze=False).astype(float))
            np.testing.assert_allclose(arrays[0], arrays[1] / 257, atol=1.01)
            with self.assertRaisesRegex(ValueError, 'not a SIDD'):
                creation.create_sidd(str(root / 'linear-8.sidd'), str(root / 'wrong.sidd'), DEFAULT)
            self.assertFalse((root / 'wrong.sidd').exists())

    def test_automatic_spacing_fits_large_projection_and_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = source_fixture(root)
            output = root / 'automatic.sidd'
            with patch.object(creation, 'MAX_OUTPUT_PIXELS', 256):
                creation.create_sidd(str(source), str(output), DEFAULT)
            with SIDDReader(str(output)) as product:
                height, width = product.get_data_size_as_tuple()[0]
                self.assertLessEqual(height * width, 256)
                self.assertGreater(product.sidd_meta[0].Measurement.PlaneProjection.SampleSpacing.Row, 1)
            with self.assertRaisesRegex(ValueError, 'at least .* m'):
                creation.create_sidd(str(source), str(root / 'explicit.sidd'), {**DEFAULT, 'pixelSpacing': .0001})

    def test_settings_projection_limits_and_cleanup(self):
        for patch in ({'version': 1}, {'bitDepth': 32}, {'contrast': 'bad'}, {'interpolation': 'bad'}, {'pixelSpacing': float('nan')}, {'pixelSpacing': -1}):
            with self.assertRaises(ValueError):
                creation.validate_settings({**DEFAULT, **patch})
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = source_fixture(root)
            output = root / 'too-large.sidd'
            with self.assertRaisesRegex(ValueError, '16 megapixels'):
                creation.create_sidd(str(source), str(output), {**DEFAULT, 'pixelSpacing': .0001})
            self.assertFalse(output.exists())
            self.assertFalse(any(item.name.startswith('.nova-sidd-') for item in root.iterdir()))
            output = root / 'coarse.sidd'
            creation.create_sidd(str(source), str(output), {**DEFAULT, 'pixelSpacing': 1})
            with SIDDReader(str(output)) as product:
                self.assertAlmostEqual(product.sidd_meta[0].Measurement.PlaneProjection.SampleSpacing.Row, 1)


if __name__ == '__main__':
    unittest.main()
