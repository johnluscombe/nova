"""Lossless rectangular crops of source SICD, SIDD, and TIFF pixels."""

import os
from pathlib import Path
import tempfile
import numpy as np


def validate_crop(value, width, height):
    """Validate integer source-pixel edges and dimensions against the decoded image grid."""

    if not isinstance(value, dict):
        raise ValueError("Invalid crop rectangle")

    keys = ("left", "top", "width", "height", "sourceWidth", "sourceHeight")

    if any(type(value.get(key)) is not int for key in keys):
        raise ValueError("Crop coordinates must be integer source pixels")

    left, top, w, h = (value[key] for key in keys[:4])

    if (
        min(left, top) < 0
        or min(w, h) < 1
        or left + w > width
        or top + h > height
        or value["sourceWidth"] != width
        or value["sourceHeight"] != height
    ):
        raise ValueError("Crop rectangle is outside the source image")

    return left, top, w, h


def clip_polygon(points, left, top, right, bottom):
    """Clip row/column vertices to an inclusive rectangular source-coordinate boundary."""

    result = [np.asarray(point, dtype=float) for point in points]

    for axis, bound, lower in (
        (0, top, True),
        (0, bottom, False),
        (1, left, True),
        (1, right, False),
    ):
        previous, result_before = result[-1] if result else None, result
        result = []

        for current in result_before:
            inside = current[axis] >= bound if lower else current[axis] <= bound
            was_inside = previous[axis] >= bound if lower else previous[axis] <= bound

            if inside != was_inside:
                weight = (bound - previous[axis]) / (current[axis] - previous[axis])
                result.append(previous + weight * (current - previous))

            if inside:
                result.append(current)

            previous = current

    return np.asarray(result)


def crop_sidd(reader, output, left, top, width, height):
    """Write a planar SIDD chip while updating reference pixels, time polynomial, and footprint.

    Detected samples are copied in bounded blocks. Valid-data vertices remain clipped
    to the selected source rectangle, and adjusted metadata must pass schema validation.
    """

    from sarpy.io.product.sidd import SIDDWriter
    from sarpy.geometry.geocoords import ecf_to_geodetic

    original = reader.sidd_meta[0]
    metadata = original.copy()
    measurement = metadata.Measurement
    plane = measurement.PlaneProjection

    if plane is None:
        raise ValueError("SIDD cropping currently requires a plane-projected product")

    # Geolocate directly on the source product's own image plane.
    source_plane = original.Measurement.PlaneProjection

    def geolocate(points):
        """Map original row/column coordinates through the product plane to latitude/longitude."""

        offsets = np.asarray(points) - source_plane.ReferencePoint.Point.get_array()
        ecf = (
            source_plane.ReferencePoint.ECEF.get_array()
            + offsets[:, 0, None]
            * source_plane.SampleSpacing.Row
            * source_plane.ProductPlane.RowUnitVector.get_array()
            + offsets[:, 1, None]
            * source_plane.SampleSpacing.Col
            * source_plane.ProductPlane.ColUnitVector.get_array()
        )

        return ecf_to_geodetic(ecf)[:, :2]

    corners = np.array(
        [
            [top, left],
            [top, left + width - 1],
            [top + height - 1, left + width - 1],
            [top + height - 1, left],
        ]
    )
    geo_corners = geolocate(corners)
    measurement.PixelFootprint.Row, measurement.PixelFootprint.Col = height, width
    plane.ReferencePoint.Point.Row -= top
    plane.ReferencePoint.Point.Col -= left
    plane.TimeCOAPoly = plane.TimeCOAPoly.shift(
        t1_shift=-top, t2_shift=-left, return_poly=False
    )

    if getattr(measurement, "ValidData", None) is not None:
        valid = clip_polygon(
            original.Measurement.ValidData.get_array(dtype=np.float64),
            left,
            top,
            left + width - 1,
            top + height - 1,
        )

        if len(valid) < 3:
            raise ValueError("Crop contains no valid SIDD image region")

        measurement.ValidData = valid - [top, left]

    if getattr(metadata, "GeoData", None) is not None:
        metadata.GeoData.ImageCorners = geo_corners
        metadata.GeoData.ValidData = (
            geolocate(valid)
            if getattr(measurement, "ValidData", None) is not None
            else geo_corners
        )
    else:
        metadata.GeographicAndTarget.GeographicCoverage.Footprint = geo_corners

    # Old downstream pixel-processing records no longer describe this chip.
    if hasattr(metadata, "DownstreamReprocessing"):
        metadata.DownstreamReprocessing = None

    from sarpy.io.product.sidd_schema import get_schema_path
    from sarpy.io.xml.base import validate_xml_from_string

    urn = metadata.get_des_details()["DESSHTN"]

    if not validate_xml_from_string(metadata.to_xml_bytes(), get_schema_path(urn)):
        raise ValueError("Cropped SIDD metadata failed XML schema validation")

    with SIDDWriter(str(output), metadata) as writer:
        rows_per_block = max(1, (8 * 1024 * 1024) // (width * 8))

        for row in range(0, height, rows_per_block):
            stop = min(height, row + rows_per_block)
            data = reader.read(
                slice(top + row, top + stop),
                slice(left, left + width),
                index=0,
                squeeze=False,
            )
            writer.write_chip(data, start_indices=(row, 0), index=0)


def crop_tiff(reader, output, left, top, width, height, guard):
    """Crop first-page TIFF pixels and shift supported GeoTIFF raster-to-model references."""

    from PIL.TiffImagePlugin import ImageFileDirectory_v2

    tags = ImageFileDirectory_v2()
    source = reader.image.tag_v2

    for key in (270, 274, 33550, 33922, 34264, 34735, 34736, 34737):
        if key in source:
            tags[key] = source[key]

    if 33922 in tags:
        ties = list(tags[33922])

        for index in range(0, len(ties), 6):
            ties[index] -= left
            ties[index + 1] -= top

        tags[33922] = tuple(ties)

    if 34264 in tags:
        matrix = np.asarray(tags[34264], dtype=float).reshape(4, 4).copy()
        matrix[:, 3] += matrix[:, 0] * left + matrix[:, 1] * top
        tags[34264] = tuple(matrix.reshape(-1))

    with guard(), reader.image.crop((left, top, left + width, top + height)) as image:
        image.save(output, format="TIFF", tiffinfo=tags)


def crop_image(file_path, directory, selection, open_reader, tiff_guard):
    """Create a lossless source-pixel SICD, planar SIDD, or TIFF crop in the assigned directory.

    The original source is unchanged. A completed temporary product is published
    without overwrite, and the source reader is always closed.
    """

    reader = open_reader(file_path)

    try:
        height, width = reader.get_data_size_as_tuple()[0]
        left, top, w, h = validate_crop(selection, width, height)
        kind = reader.reader_type
        extension = {"SICD": ".sicd", "SIDD": ".sidd", "TIFF": ".tiff"}.get(kind)

        if extension is None:
            raise ValueError(
                "Cropping currently supports formed images, not CPHD phase history"
            )

        output = Path(directory) / (Path(file_path).stem + "-crop" + extension)

        with tempfile.TemporaryDirectory(
            prefix=".nova-crop-", dir=directory
        ) as temporary:
            generated = Path(temporary) / ("crop" + extension)

            if kind == "SICD":
                from sarpy.utils.chip_sicd import create_chip

                create_chip(
                    reader,
                    temporary,
                    output_file=generated.name,
                    row_limits=(top, top + h),
                    col_limits=(left, left + w),
                    preserve_nitf_information=True,
                )
            elif kind == "SIDD":
                crop_sidd(reader, generated, left, top, w, h)
            else:
                crop_tiff(reader, generated, left, top, w, h, tiff_guard)

            os.link(generated, output)

        return {"path": str(output)}
    finally:
        reader.close()
