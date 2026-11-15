"""Bounded CPU backprojection of monostatic FX CPHD onto a local ground plane.

No radiometric calibration, autofocus, or terrain correction is inferred.
"""
import base64
import json
import struct
import zlib
import math
import os
import tempfile
from pathlib import Path
import numpy as np

C = 299792458.0


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid image formation settings")
    size, spacing, count = (value.get(key) for key in ("imageSize", "pixelSpacing", "maxVectors"))
    if (value.get("algorithm") != "backprojection" or type(size) is not int or size not in (64, 128, 256, 512)
            or type(spacing) not in (int, float) or not math.isfinite(spacing) or not 0 <= spacing <= 1000
            or type(count) is not int or not 8 <= count <= 4096 or value.get("window") not in ("hann", "uniform")):
        raise ValueError("Invalid image formation settings")
    return dict(value)


def unit(vector):
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm < 1e-8:
        raise ValueError("CPHD geometry cannot define an image plane")
    return vector / norm


def prepare(reader, settings):
    from sarpy.geometry.geocoords import wgs_84_norm
    meta = reader.cphd_meta
    if not hasattr(meta, "SceneCoordinates") or meta.Global.DomainType != "FX":
        raise ValueError("Image formation currently requires FX-domain CPHD 1.x")
    if meta.CollectionID.CollectType != "MONOSTATIC":
        raise ValueError("Image formation currently requires monostatic CPHD")
    if getattr(getattr(meta.CollectionID, "RadarMode", None), "ModeType", None) not in ("SPOTLIGHT", "STRIPMAP", "DYNAMIC STRIPMAP"):
        raise ValueError("CPHD is missing its radar collection mode")
    if meta.Global.SGN not in (-1, 1):
        raise ValueError("CPHD is missing its phase sign convention")
    if getattr(meta.Data, "SignalCompressionID", None):
        raise ValueError("Compressed CPHD signal arrays are not supported")
    nv, ns = reader.get_data_size_as_tuple()[0]
    if nv < 8 or ns < 4 or ns > 262144:
        raise ValueError("Image formation requires at least 8 vectors and 4–262144 samples per vector")
    count = min(nv, settings["maxVectors"])
    start = (nv - count) // 2
    indices = np.arange(start, start + count)
    pvp = {}
    for field in ("TxPos", "RcvPos", "SRPPos", "TxTime", "RcvTime", "SC0", "SCSS", "FX1", "FX2"):
        values = reader.read_pvp_variable(field, 0, (start, start + count, 1))
        shape = (count, 3) if field.endswith("Pos") else (count,)
        if values is None or np.shape(values) != shape or not np.all(np.isfinite(values)):
            raise ValueError(f"CPHD is missing finite per-vector {field} coordinates")
        pvp[field] = np.asarray(values, dtype=np.float64)
    if np.any(pvp["SCSS"] <= 0) or np.any(pvp["SC0"] <= 0) or np.any(pvp["FX2"] <= pvp["FX1"]):
        raise ValueError("CPHD frequency coordinates must have positive spacing and valid support")
    # A SICD monostatic ARP cannot describe distinct transmit/receive tracks.
    # Permit only the small platform displacement during the round-trip time.
    separation = np.linalg.norm(pvp["TxPos"] - pvp["RcvPos"], axis=1)
    travel = np.abs(pvp["RcvTime"] - pvp["TxTime"])
    if np.any(separation > np.maximum(1.0, 12000 * travel)):
        raise ValueError("Transmit/receive geometry is outside monostatic support")
    pvp["FX1"] = np.maximum(pvp["FX1"], pvp["SC0"])
    pvp["FX2"] = np.minimum(pvp["FX2"], pvp["SC0"] + (ns - 1) * pvp["SCSS"])
    if np.any(pvp["FX2"] <= pvp["FX1"]) or np.any(pvp["RcvTime"] < pvp["TxTime"]):
        raise ValueError("CPHD has invalid frequency support or transmit/receive times")
    signal = reader.read_pvp_variable("SIGNAL", 0, (start, start + count, 1))
    if signal is not None and not np.all(signal == 1):
        raise ValueError("Selected aperture contains vectors marked as invalid signal; choose a smaller aperture")
    times = (pvp["TxTime"] + pvp["RcvTime"]) / 2
    if np.any(np.diff(times) <= 0):
        raise ValueError("CPHD vector times must be strictly increasing")
    try:
        center = np.asarray(meta.SceneCoordinates.IARP.ECF.get_array(), dtype=np.float64)
    except AttributeError as error:
        raise ValueError("CPHD requires an ECEF scene reference point") from error
    if not np.all(np.isfinite(center)) or np.linalg.norm(center) < 6e6:
        raise ValueError("CPHD scene reference point is invalid")
    normal = wgs_84_norm(center)
    arp = (pvp["TxPos"] + pvp["RcvPos"]) / 2
    look = center - arp[count // 2]
    row = unit(look - np.dot(look, normal) * normal)
    column = unit(np.cross(normal, row))
    direction = (center - pvp["TxPos"]) / np.linalg.norm(center - pvp["TxPos"], axis=1)[:, None]
    direction += (center - pvp["RcvPos"]) / np.linalg.norm(center - pvp["RcvPos"], axis=1)[:, None]
    frequencies = np.stack([pvp["FX1"], pvp["FX2"]], axis=1)
    spectra = [frequencies * (direction @ axis)[:, None] / C for axis in (row, column)]
    bandwidths = [float(np.ptp(spectrum)) for spectrum in spectra]
    if min(bandwidths) < 1e-8:
        raise ValueError("Selected aperture has insufficient spatial bandwidth")
    spacing = settings["pixelSpacing"] or 0.8 / max(bandwidths)
    if spacing * max(bandwidths) > 1:
        raise ValueError(f"Pixel spacing is too coarse for this aperture; use automatic spacing or at most {1 / max(bandwidths):.6g} m")
    return meta, indices, ns, pvp, times, center, row, column, spacing, bandwidths, spectra


def diagnostic_preview(values):
    """Small, display-only log-amplitude PNG; never substitutes for source data."""
    step = max(1, math.ceil(max(values.shape) / 512))
    magnitude = np.log1p(np.abs(values[::step, ::step]).astype(np.float64))
    finite = np.isfinite(magnitude)
    pixels = np.zeros(magnitude.shape, dtype=np.uint8)
    if finite.any():
        low, high = np.percentile(magnitude[finite], [1, 99])
        if high - low > max(1e-12, abs(high) * 1e-6):
            pixels = np.clip(np.where(finite, (magnitude - low) / (high - low), 0) * 255, 0, 255).astype(np.uint8)
        else:
            pixels[finite] = 127
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    height, width = pixels.shape
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row.tobytes() for row in pixels))) + chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def product(identifier, title, description, values):
    return dict(id=identifier, title=title, description=description, previewDataUrl=diagnostic_preview(values))


def backproject(reader, prepared, settings, products=None):
    meta, indices, ns, pvp, times, center, row, column, spacing, bandwidths, spectra = prepared
    size, sgn = settings["imageSize"], meta.Global.SGN
    coordinates = (np.arange(size) - size // 2) * spacing
    points = center + coordinates[:, None, None] * row + coordinates[None, :, None] * column
    image = np.zeros((size, size), dtype=np.complex128)
    nfft = 1 << math.ceil(math.log2(ns * 4))
    taper = np.hanning(ns) if settings["window"] == "hann" else np.ones(ns)
    aperture = np.hanning(len(indices)) if settings["window"] == "hann" else np.ones(len(indices))
    total_weight = 0.0
    diagnostic_rows = np.unique(np.linspace(0, len(indices) - 1, min(256, len(indices))).astype(int))
    diagnostic_columns = np.unique(np.linspace(0, ns - 1, min(512, ns)).astype(int))
    input_samples = np.zeros((len(diagnostic_rows), len(diagnostic_columns)), dtype=np.complex64)
    windowed_samples = np.zeros_like(input_samples)
    range_samples = np.zeros((len(diagnostic_rows), 512), dtype=np.float64)
    row_lookup = {int(value): i for i, value in enumerate(diagnostic_rows)}
    # All range-profile thumbnails share a delay grid despite per-vector SCSS.
    delay_extent = 0.49 / float(pvp["SCSS"].max())
    diagnostic_delays = np.linspace(-delay_extent, delay_extent, 512)
    checkpoints = {math.ceil(len(indices) * fraction / 100) - 1: fraction for fraction in (25, 50, 75)}
    partial_products = []
    for i, vector in enumerate(indices):
        f0, df = pvp["SC0"][i], pvp["SCSS"][i]
        frequencies = f0 + np.arange(ns) * df
        support = (frequencies >= pvp["FX1"][i]) & (frequencies <= pvp["FX2"][i])
        weights = taper * support
        if np.count_nonzero(weights) < 2:
            raise ValueError("CPHD frequency support contains too few usable samples")
        samples = reader.read(slice(int(vector), int(vector) + 1), slice(0, ns), index=0, squeeze=False).reshape(-1)
        if not np.all(np.isfinite(samples)):
            raise ValueError("CPHD signal contains nonfinite samples")
        reference = (np.linalg.norm(pvp["TxPos"][i] - pvp["SRPPos"][i]) +
                     np.linalg.norm(pvp["RcvPos"][i] - pvp["SRPPos"][i]))
        delay = (np.linalg.norm(points - pvp["TxPos"][i], axis=-1) +
                 np.linalg.norm(points - pvp["RcvPos"][i], axis=-1) - reference) / C
        bins = np.fft.fftshift(np.fft.fftfreq(nfft, df))
        if delay.min() < bins[0] or delay.max() > bins[-1]:
            raise ValueError("Output scene exceeds the unambiguous delay interval; reduce output size or pixel spacing")
        profile = (np.fft.ifft(samples * weights, nfft) * nfft if sgn == -1
                   else np.fft.fft(samples * weights, nfft))
        profile = np.fft.fftshift(profile)
        fc = f0 + (ns // 2) * df
        # Interpolate the baseband envelope, then restore its carrier phase.
        profile *= np.exp(-sgn * 2j * np.pi * (f0 - fc) * bins)
        if products is not None and i in row_lookup:
            row_index = row_lookup[i]
            input_samples[row_index] = samples[diagnostic_columns]
            windowed_samples[row_index] = (samples * weights * aperture[i])[diagnostic_columns]
            range_samples[row_index] = np.interp(diagnostic_delays, bins, np.abs(profile))
        values = np.interp(delay, bins, profile.real) + 1j * np.interp(delay, bins, profile.imag)
        image += aperture[i] * values * np.exp(-sgn * 2j * np.pi * fc * delay)
        total_weight += aperture[i] * weights.sum()
        if products is not None and i in checkpoints:
            fraction = checkpoints[i]
            partial_products.append(product(f"aperture-{fraction}", f"{fraction}% aperture",
                f"Coherent sum after {i + 1} of {len(indices)} selected vectors. Horizontal: ground column; vertical: ground row. Log-amplitude display with independent contrast stretch.",
                image / max(total_weight, 1e-30)))
    image /= total_weight
    # Shift the common spatial carrier to baseband before sampling/export.
    centers = [(float(s.min()) + float(s.max())) / 2 for s in spectra]
    image *= np.exp(sgn * 2j * np.pi * (coordinates[:, None] * centers[0] + coordinates[None, :] * centers[1]))
    if not np.all(np.isfinite(image)):
        raise ValueError("Image formation produced nonfinite samples")
    if products is not None:
        products.extend([
            product("input", "Input phase history", f"Selected first-channel aperture: vectors {indices[0]}–{indices[-1]}. Horizontal: frequency sample index; vertical: vector index. Sampled log-amplitude preview.", input_samples),
            product("windowed", "Windowed phase history", f"{settings['window'].capitalize()} frequency and aperture weights, including valid frequency support. Horizontal: frequency sample index; vertical: vector index. Sampled log-amplitude preview.", windowed_samples),
            product("range-compressed", "Range-compressed profiles", f"Before backprojection. Horizontal: relative delay from {-delay_extent * 1e9:.6g} to {delay_extent * 1e9:.6g} ns, relative to each vector's SRP; vertical: vector index. Sampled log-amplitude preview.", range_samples),
            *partial_products,
            product("final", "Uncalibrated SICD", "Completed coherent sum on the local ground plane. Select this slide to use the image analysis tools.", image)
        ])
    return image.astype(np.complex64)


def sicd_metadata(prepared, settings):
    from sarpy.io.complex.sicd_elements.SICD import SICDType
    from sarpy.geometry.geocoords import ecf_to_geodetic
    meta, indices, ns, pvp, times, center, row, column, spacing, bandwidths, spectra = prepared
    size = settings["imageSize"]
    arp = (pvp["TxPos"] + pvp["RcvPos"]) / 2
    polynomials = [np.polynomial.Polynomial.fit(times, arp[:, axis], min(5, len(times) - 1)).convert().coef for axis in range(3)]
    fitted = np.stack([np.polynomial.polynomial.polyval(times, poly) for poly in polynomials], axis=1)
    if np.max(np.linalg.norm(fitted - arp, axis=1)) > 0.001:
        raise ValueError("Selected aperture trajectory cannot be represented accurately; choose a smaller aperture")
    collection_start = getattr(getattr(meta.Global, "Timeline", None), "CollectionStart", None)
    if collection_start is None:
        raise ValueError("CPHD is missing its collection start time")
    parameters = getattr(meta.Channel, "Parameters", None)
    channel = next((item for item in (parameters or []) if item.Identifier == meta.Data.Channels[0].Identifier), None)
    polarization = getattr(channel, "Polarization", None)
    tx, rx = getattr(polarization, "TxPol", "UNKNOWN"), getattr(polarization, "RcvPol", "UNKNOWN")
    # SICD does not accept CPHD's extended polarization vocabulary verbatim.
    tx = tx if tx in ("H", "V", "RHC", "LHC") else "UNKNOWN"
    rx = rx if rx in ("H", "V", "RHC", "LHC") else "UNKNOWN"
    combined = f"{tx}:{rx}" if tx != "UNKNOWN" and rx != "UNKNOWN" else "UNKNOWN"
    low, high = float(pvp["FX1"].min()), float(pvp["FX2"].max())
    directions = []
    for vector, bandwidth, spectrum in zip((row, column), bandwidths, spectra):
        directions.append(dict(UVectECF=vector, SS=spacing, Sgn=meta.Global.SGN,
                               ImpRespBW=bandwidth, ImpRespWid=(1.44 if settings["window"] == "hann" else 0.886) / bandwidth,
                               KCtr=(float(spectrum.min()) + float(spectrum.max())) / 2,
                               DeltaK1=-bandwidth / 2, DeltaK2=bandwidth / 2,
                               DeltaKCOAPoly=[[0]], WgtType={"WindowName": "HANNING" if settings["window"] == "hann" else "UNIFORM"}))
    corners = []
    for r, c in ((0, 0), (0, size - 1), (size - 1, size - 1), (size - 1, 0)):
        llh = ecf_to_geodetic(center + (r - size // 2) * spacing * row + (c - size // 2) * spacing * column)
        corners.append(llh[:2])
    result = SICDType(
        CollectionInfo={"CollectorName": meta.CollectionID.CollectorName, "CoreName": meta.CollectionID.CoreName + "_Nova_BP",
                        "CollectType": "MONOSTATIC", "RadarMode": {"ModeType": meta.CollectionID.RadarMode.ModeType},
                        "Classification": meta.CollectionID.Classification,
                        "Parameters": {"SourceChannel": meta.Data.Channels[0].Identifier, "ImageFormation": "Nova CPU backprojection", "Radiometry": "Uncalibrated", "SourceVectorStart": str(indices[0]), "SourceVectorCount": str(len(indices))}},
        ImageCreation={"Application": "Nova CPU backprojection", "DateTime": np.datetime64("now", "us"), "Profile": "Local ground plane"},
        ImageData={"PixelType": "RE32F_IM32F", "NumRows": size, "NumCols": size, "FirstRow": 0, "FirstCol": 0,
                   "FullImage": [size, size], "SCPPixel": [size // 2, size // 2]},
        GeoData={"SCP": {"ECF": center}, "ImageCorners": corners},
        Grid={"ImagePlane": "GROUND", "Type": "PLANE", "TimeCOAPoly": [[float(times[len(times) // 2])]], "Row": directions[0], "Col": directions[1]},
        Timeline={"CollectStart": collection_start, "CollectDuration": float(max(pvp["RcvTime"].max(), times.max()))},
        Position={"ARPPoly": dict(zip(("X", "Y", "Z"), polynomials))},
        RadarCollection={"TxFrequency": {"Min": low, "Max": high}, "TxPolarization": tx,
                         "RcvChannels": [{"index": 1, "TxRcvPolarization": combined}]},
        ImageFormation={"RcvChanProc": {"NumChanProc": 1, "ChanIndices": [1]}, "TxRcvPolarizationProc": combined,
                        "TStartProc": float(times[0]), "TEndProc": float(times[-1]), "TxFrequencyProc": {"MinProc": low, "MaxProc": high},
                        "ImageFormAlgo": "OTHER", "STBeamComp": "NO", "ImageBeamComp": "NO", "AzAutofocus": "NO", "RgAutofocus": "NO"})
    result.derive()
    from sarpy.io.complex.sicd_schema import get_schema_path
    from sarpy.io.xml.base import validate_xml_from_string
    # OTHER is a schema-supported algorithm. SarPy's detailed checker treats
    # all OTHER algorithms as failures because it cannot validate their models.
    if not validate_xml_from_string(result.to_xml_bytes(), get_schema_path("urn:SICD:1.3.0")):
        raise ValueError("CPHD geometry could not produce valid SICD metadata")
    return result


def form_sicd(file_path, output_path, options):
    from sarpy.io.phase_history.cphd import CPHDReader
    from sarpy.io.complex.sicd import SICDWriter
    settings = validate_settings(options)
    output = Path(output_path)
    if output.exists() or output.suffix.lower() != ".sicd":
        raise ValueError("SICD output must be a new .sicd file")
    reader = CPHDReader(file_path)
    temporary = None
    preview_temporary = None
    try:
        prepared = prepare(reader, settings)
        metadata = sicd_metadata(prepared, settings)
        products = []
        image = backproject(reader, prepared, settings, products)
        with tempfile.NamedTemporaryFile(prefix=".nova-formation-", dir=output.parent, delete=False) as handle:
            temporary = handle.name
        with SICDWriter(temporary, metadata, check_existence=False) as writer:
            writer.write_chip(image)
        # Publish only complete files and never replace an existing product.
        sidecar = Path(str(output) + ".formation.json")
        # Both files must be complete before exposing the SICD to the application.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".nova-previews-", dir=output.parent, delete=False) as handle:
            preview_temporary = handle.name
            json.dump(dict(version=1, products=products), handle, allow_nan=False)
        os.link(preview_temporary, sidecar)
        try:
            os.link(temporary, output)
        except Exception:
            sidecar.unlink()
            raise
        return {"path": str(output)}
    finally:
        reader.close()
        if temporary is not None:
            os.unlink(temporary)
        if preview_temporary is not None:
            os.unlink(preview_temporary)
