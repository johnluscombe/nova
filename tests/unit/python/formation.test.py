"""Image formation tests with a synthesized point target in a real CPHD file."""

import sys

sys.dont_write_bytecode = True
import importlib.util
import json
import base64
import struct
import pathlib
import tempfile
import unittest
import numpy as np
from sarpy.io.phase_history.cphd import CPHDWriter1
from sarpy.io.phase_history.cphd1_elements.CPHD import CPHDType
from sarpy.io.complex.sicd import SICDReader

folder = (
    pathlib.Path(__file__).resolve().parents[3]
    / "src-electron/electron-assets/plugins/scientific-imagery"
)
spec = importlib.util.spec_from_file_location("formation", folder / "formation.py")
formation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(formation)


class FormationTests(unittest.TestCase):
    @staticmethod
    def fixture(file, sgn=-1, domain="FX", varying=False):
        """Write a real FX/TOA CPHD fixture with a synthetic point target and optional varying coordinates."""

        nv, ns = 64, 128
        fields, offset = {}, 0

        for key in (
            "TxPos",
            "RcvPos",
            "SRPPos",
            "TxTime",
            "RcvTime",
            "SC0",
            "SCSS",
            "FX1",
            "FX2",
        ):
            fields[key] = {"Offset": offset}
            offset += 3 if key.endswith("Pos") else 1

        meta = CPHDType(
            CollectionID={
                "CollectorName": "Synthetic",
                "CoreName": "Point target",
                "CollectType": "MONOSTATIC",
                "RadarMode": {"ModeType": "SPOTLIGHT"},
                "Classification": "UNCLASSIFIED",
                "ReleaseInfo": "UNRESTRICTED",
            },
            Global={
                "DomainType": domain,
                "SGN": sgn,
                "Timeline": {"CollectionStart": "2025-01-01T00:00:00Z"},
            },
            SceneCoordinates={"IARP": {"ECF": [6378137, 0, 0]}},
            Data={
                "SignalArrayFormat": "CF8",
                "NumBytesPVP": offset * 8,
                "Channels": [
                    {
                        "Identifier": "test",
                        "NumVectors": nv,
                        "NumSamples": ns,
                        "SignalArrayByteOffset": 0,
                        "PVPArrayByteOffset": 0,
                    }
                ],
            },
            PVP=fields,
        )
        pvp = np.zeros(nv, dtype=meta.PVP.get_vector_dtype())
        center = np.array([6378137.0, 0, 0])
        positions = np.tile(center + [1000, -1000, 0], (nv, 1))
        positions[:, 2] = np.linspace(-100, 100, nv)

        for key in ("TxPos", "RcvPos"):
            pvp[key] = positions

        pvp["SRPPos"] = center
        pvp["TxTime"] = np.linspace(0, 1, nv)
        pvp["RcvTime"] = pvp["TxTime"] + 0.00001
        pvp["SC0"], pvp["SCSS"] = 1e9, 1e6

        if varying:
            pvp["SC0"] += np.linspace(-2e6, 2e6, nv)
            pvp["SRPPos"][:, 1] += np.sin(np.linspace(0, 1, nv))

        frequencies = pvp["SC0"][:, None] + np.arange(ns) * 1e6
        pvp["FX1"], pvp["FX2"] = frequencies[:, 0], frequencies[:, -1]
        # Row points along +Y; column along +Z for this local plane.
        target = center + [0, 3, -4]
        delay = (
            2
            * (
                np.linalg.norm(positions - target, axis=1)
                - np.linalg.norm(positions - pvp["SRPPos"], axis=1)
            )
            / formation.C
        )
        data = np.exp(sgn * 2j * np.pi * delay[:, None] * frequencies).astype(
            "complex64"
        )

        with CPHDWriter1(str(file), meta, check_existence=False) as writer:
            writer.write_file({"test": pvp}, {"test": data})

    def test_point_target_and_valid_sicd_for_both_signs(self):
        for sgn in (-1, 1):
            with self.subTest(sgn=sgn), tempfile.TemporaryDirectory() as directory:
                source, output = [
                    pathlib.Path(directory) / name
                    for name in ("source.cphd", "formed.sicd")
                ]
                self.fixture(source, sgn)
                settings = dict(
                    algorithm="backprojection",
                    imageSize=64,
                    pixelSpacing=0.5,
                    maxVectors=64,
                    window="uniform",
                )
                formation.form_sicd(str(source), str(output), settings)

                with SICDReader(str(output)) as product:
                    image = product.read(squeeze=False)
                    peak = np.unravel_index(np.abs(image).argmax(), image.shape)
                    self.assertEqual(peak, (38, 24))
                    self.assertGreater(np.abs(image[peak]), 0.95)
                    meta = product.get_sicds_as_tuple()[0]
                    from sarpy.io.xml.base import validate_xml_from_string
                    from sarpy.io.complex.sicd_schema import get_schema_path

                    self.assertTrue(
                        validate_xml_from_string(
                            meta.to_xml_bytes(), get_schema_path("urn:SICD:1.3.0")
                        )
                    )
                    self.assertEqual(meta.ImageFormation.ImageFormAlgo, "OTHER")
                    self.assertIsNone(meta.Radiometric)
                    self.assertEqual(meta.Grid.Row.SS, 0.5)

                diagnostics = json.loads(
                    pathlib.Path(str(output) + ".formation.json").read_text()
                )
                self.assertEqual(
                    [p["id"] for p in diagnostics["products"]],
                    [
                        "input",
                        "windowed",
                        "range-compressed",
                        "aperture-25",
                        "aperture-50",
                        "aperture-75",
                        "final",
                    ],
                )
                self.assertEqual(diagnostics["version"], 1)

                for slide in diagnostics["products"]:
                    png = base64.b64decode(slide["previewDataUrl"].split(",")[1])
                    self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
                    self.assertLessEqual(max(struct.unpack(">II", png[16:24])), 512)

                with self.assertRaisesRegex(ValueError, "new .sicd"):
                    formation.form_sicd(str(source), str(output), settings)

    def test_varying_coordinates_and_automatic_hann_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = [
                pathlib.Path(directory) / name
                for name in ("source.cphd", "formed.sicd")
            ]
            self.fixture(source, varying=True)
            settings = dict(
                algorithm="backprojection",
                imageSize=64,
                pixelSpacing=0,
                maxVectors=32,
                window="hann",
            )
            formation.form_sicd(str(source), str(output), settings)

            with SICDReader(str(output)) as product:
                image = product.read(squeeze=False)
                peak = np.unravel_index(np.abs(image).argmax(), image.shape)
                spacing = product.get_sicds_as_tuple()[0].Grid.Row.SS
                self.assertAlmostEqual((peak[0] - 32) * spacing, 3, delta=spacing)
                self.assertAlmostEqual((peak[1] - 32) * spacing, -4, delta=spacing)
                self.assertGreater(np.abs(image[peak]), 0.7)
                self.assertGreater(spacing, 0)

            with self.assertRaisesRegex(ValueError, "too coarse"):
                formation.form_sicd(
                    str(source),
                    str(pathlib.Path(directory) / "coarse.sicd"),
                    {**settings, "pixelSpacing": 1000},
                )

            self.assertFalse((pathlib.Path(directory) / "coarse.sicd").exists())

    def test_rejects_unsupported_domain_and_bad_settings(self):
        settings = dict(
            algorithm="backprojection",
            imageSize=64,
            pixelSpacing=0,
            maxVectors=64,
            window="hann",
        )

        for patch in (
            {"imageSize": 999},
            {"maxVectors": 0},
            {"pixelSpacing": float("nan")},
            {"window": "bad"},
        ):
            with self.assertRaises(ValueError):
                formation.validate_settings({**settings, **patch})

        with tempfile.TemporaryDirectory() as directory:
            source, output = [
                pathlib.Path(directory) / name
                for name in ("source.cphd", "formed.sicd")
            ]
            self.fixture(source, domain="TOA")

            with self.assertRaisesRegex(ValueError, "FX-domain"):
                formation.form_sicd(str(source), str(output), settings)

            self.assertFalse(output.exists())
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [source])


if __name__ == "__main__":
    unittest.main()
