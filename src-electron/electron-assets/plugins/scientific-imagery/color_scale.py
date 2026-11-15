"""Validated scalar clipping and RGB gradients shared by preview and export."""

import math
import re
import numpy as np


def validate_scale(scale):
    """Require finite optional limits and 2–8 RGB stops before allocating colors."""
    if not isinstance(scale, dict):
        raise ValueError("Invalid color scale")
    limits = [scale.get("minimum"), scale.get("maximum")]
    if any(
        value is not None
        and (type(value) not in (int, float) or not math.isfinite(value))
        for value in limits
    ):
        raise ValueError("Color scale limits must be finite")
    if all(value is not None for value in limits) and limits[0] >= limits[1]:
        raise ValueError("Color scale minimum must be below maximum")
    colors = scale.get("colors")
    if (
        not isinstance(colors, list)
        or not 2 <= len(colors) <= 8
        or not all(
            isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
            for color in colors
        )
    ):
        raise ValueError("Choose 2–8 RGB colors")
    return scale


def color_bounds(reference, scale, logarithmic=False):
    """Resolve automatic percentile limits once, retaining the preview's amplitude log mapping."""
    validate_scale(scale)
    data = np.asarray(reference, dtype=np.float64)
    valid = np.isfinite(data) & (data > 0 if logarithmic else True)
    display = np.log1p(data[valid]) if logarithmic else data[valid]
    low, high = np.percentile(display, [1, 99]) if display.size else (0, 0)
    for key in ("minimum", "maximum"):
        value = scale[key]
        if value is not None:
            if logarithmic and value < 0:
                raise ValueError("Amplitude color scale limits cannot be negative")
            value = math.log1p(value) if logarithmic else value
            if key == "minimum":
                low = value
            else:
                high = value
    if low > high or (
        low == high and any(scale[key] is not None for key in ("minimum", "maximum"))
    ):
        raise ValueError("Resolved color scale minimum must be below maximum")
    return low, high


def apply_colors(values, scale, bounds, logarithmic=False):
    """Interpolate RGB stops and clip out-of-range values, leaving invalid samples black."""
    data = np.asarray(values, dtype=np.float64)
    valid = np.isfinite(data) & (data >= 0 if logarithmic else True)
    safe = np.where(valid, data, 0)
    if logarithmic:
        safe = np.log1p(safe)
    low, high = bounds
    fraction = (
        np.clip((safe - low) / (high - low), 0, 1)
        if high > low
        else np.full(data.shape, 0.5)
    )
    stops = np.array(
        [[int(color[i : i + 2], 16) for i in (1, 3, 5)] for color in scale["colors"]]
    )
    positions = np.linspace(0, 1, len(stops))
    rgb = np.stack(
        [np.interp(fraction, positions, stops[:, channel]) for channel in range(3)],
        axis=-1,
    )
    return np.where(valid[..., None], np.floor(rgb + 0.5), 0).astype(np.uint8)


def colorize(values, scale, logarithmic=False):
    """Color a bounded preview using its own automatic reference limits."""
    return apply_colors(
        values, scale, color_bounds(values, scale, logarithmic), logarithmic
    )
