"""Create detected, planar SIDD products from source complex SICD samples."""

import math
import os
from pathlib import Path
import tempfile
import numpy as np


def validate_settings(value):
    """Validate SIDD version, output depth, contrast, interpolation, and meter spacing."""

    if (
        not isinstance(value, dict)
        or type(value.get("version")) is not int
        or value["version"] not in (2, 3)
        or type(value.get("bitDepth")) is not int
        or value["bitDepth"] not in (8, 16)
        or value.get("contrast") not in ("density", "linear", "logarithmic")
        or value.get("interpolation") not in ("nearest", "bilinear")
        or type(value.get("pixelSpacing")) not in (int, float)
        or not math.isfinite(value["pixelSpacing"])
        or not 0 <= value["pixelSpacing"] <= 1000
    ):
        raise ValueError("Invalid SIDD creation settings")

    return dict(value)


def source_statistics(reader):
    """Estimate global display parameters on a bounded source-amplitude grid.

    Supply these explicitly so remaps stay consistent across processing blocks,
    independent of SarPy versions' reader-statistics helper implementations.
    """

    height, width = reader.get_data_size_as_tuple()[0]
    step = max(1, math.ceil(max(height, width) / 1024))
    total, count, minimum, maximum = 0.0, 0, float("inf"), 0.0

    for row in range(0, height, step):
        values = np.abs(
            reader.read(
                slice(row, row + 1), slice(0, width, step), index=0, squeeze=False
            ).astype(np.complex128)
        )
        finite = values[np.isfinite(values)]

        if finite.size:
            total += float(finite.sum())
            count += finite.size
            minimum = min(minimum, float(finite.min()))
            maximum = max(maximum, float(finite.max()))

    if not count:
        raise ValueError("SICD contains no finite samples for display mapping")

    return (
        max(total / count, 1e-12),
        min(minimum, maximum),
        max(maximum, minimum + 1e-12),
    )


MAX_OUTPUT_PIXELS = 16777216
MAX_OUTPUT_SIDE = 16384


def fit_output_grid(helper, automatic):
    """Fit full scene coverage by updating the helper's projection spacing in place.

    Args:
        helper: Orthorectification helper whose projected bounds are recomputed.
        automatic: Allow coarser spacing when True; preserve explicit spacing otherwise.

    Returns:
        Finite row/column bounds within the output area and side-length limits.

    Raises:
        ValueError: Invalid geometry, a degenerate projected image, or explicit
            spacing that exceeds the output limits.
    """

    for _ in range(8):
        bounds = np.asarray(helper.get_full_ortho_bounds(), dtype=np.float64)

        if bounds.shape != (4,) or not np.all(np.isfinite(bounds)):
            raise ValueError("SICD produced invalid projected image bounds")

        height, width = bounds[1] - bounds[0], bounds[3] - bounds[2]

        if min(height, width) < 2:
            raise ValueError(
                f"Projected SIDD is only {int(width)} × {int(height)} pixels; decrease SIDD pixel spacing in Settings or use 0 for automatic spacing"
            )

        factor = max(
            math.sqrt(height * width / MAX_OUTPUT_PIXELS),
            height / MAX_OUTPUT_SIDE,
            width / MAX_OUTPUT_SIDE,
        )

        if factor <= 1:
            return bounds

        projection = helper.proj_helper
        suggested = max(projection.row_spacing, projection.col_spacing) * factor * 1.02

        if not automatic:
            raise ValueError(
                f"Projected SIDD is {int(width):,} × {int(height):,} pixels, exceeding the 16 megapixels / 16,384 pixels per side limit. Set SIDD pixel spacing to 0 for automatic sizing, or try at least {suggested:.6g} m."
            )

        projection.row_spacing *= factor * 1.02
        projection.col_spacing *= factor * 1.02

    raise ValueError(
        "Could not fit the projected SIDD within output limits; check source geometry or choose a larger SIDD pixel spacing"
    )


def create_sidd(file_path, output_path, options):
    """Create a planar detected SIDD from original SICD samples and validated preferences.

    Automatic spacing fits the full scene within the output limits. Display parameters
    are fixed across processing blocks. The source SICD metadata is embedded, and the
    completed product is schema-validated before publication without overwrite.
    """

    settings = validate_settings(options)
    output = Path(output_path)

    if output.exists() or output.suffix.lower() != ".sidd":
        raise ValueError("SIDD output must be a new .sidd file")

    from sarpy.io.complex.sicd import SICDReader
    from sarpy.io.product.sidd import SIDDReader, SIDDDetails
    from sarpy.io.general.base import SarpyIOError
    from sarpy.io.product.sidd_schema import get_schema_path
    from sarpy.io.xml.base import validate_xml_from_string

    try:
        SIDDDetails(file_path)
    except (SarpyIOError, ValueError):
        pass
    else:
        raise ValueError("Create SIDD requires a SICD source, not a SIDD product")

    with tempfile.TemporaryDirectory(
        prefix=".nova-sidd-", dir=output.parent
    ) as temporary:
        # Matplotlib is an optional import in SarPy's display remap module.
        os.environ.setdefault("MPLCONFIGDIR", temporary)
        from sarpy.processing.ortho_rectify import (
            PGProjection,
            NearestNeighborMethod,
            BivariateSplineMethod,
        )
        from sarpy.processing.sidd.sidd_product_creation import (
            create_detected_image_sidd,
        )
        from sarpy.visualization.remap import Density, Linear, Logarithmic

        with SICDReader(file_path) as reader:
            metadata = reader.get_sicds_as_tuple()[0]

            try:
                spacing = settings["pixelSpacing"] or None
                projection = PGProjection(
                    metadata, row_spacing=spacing, col_spacing=spacing
                )
                method = (
                    NearestNeighborMethod
                    if settings["interpolation"] == "nearest"
                    else BivariateSplineMethod
                )
                helper = method(
                    reader, index=0, proj_helper=projection, complex_valued=False
                )
            except (AttributeError, ValueError, TypeError) as error:
                raise ValueError(
                    "SICD-to-SIDD requires valid image projection, trajectory, and scene geometry"
                ) from error

            fit_output_grid(helper, settings["pixelSpacing"] == 0)
            mean, minimum, maximum = source_statistics(reader)

            if settings["contrast"] == "density":
                remap = Density(bit_depth=settings["bitDepth"], data_mean=mean)
            else:
                remap_type = Linear if settings["contrast"] == "linear" else Logarithmic
                remap = remap_type(
                    bit_depth=settings["bitDepth"], min_value=minimum, max_value=maximum
                )

            temporary_output = Path(temporary) / "detected.sidd"
            create_detected_image_sidd(
                helper,
                temporary,
                output_file=temporary_output.name,
                block_size=16,
                version=settings["version"],
                include_sicd=True,
                remap_function=remap,
            )

        with SIDDReader(str(temporary_output)) as product:
            sidd = product.sidd_meta[0]
            urn = f"urn:SIDD:{settings['version']}.0.0"

            if not validate_xml_from_string(sidd.to_xml_bytes(), get_schema_path(urn)):
                raise ValueError("Generated SIDD metadata failed XML schema validation")

        os.link(temporary_output, output)

    return {"path": str(output)}
