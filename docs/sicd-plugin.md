# SICD / SIDD plugin

The bundled `nova.sicd` plugin opens SICD and SIDD NITF files with `.sicd`,
`.sidd`, `.nitf`, or `.ntf` extensions. It identifies the product from its metadata,
not its extension, using NGA's SarPy readers in a separate Python process. Both
formats use the same `parameters.python` interpreter setting. Ordinary NITF files
without SICD or SIDD metadata are not supported.

## Runtime setup

Install Python 3 and create a dedicated environment at a persistent location:

```sh
python3 -m venv "$HOME/.nova-sicd"
"$HOME/.nova-sicd/bin/python" -m pip install -r src-electron/electron-assets/plugins/sicd/requirements.txt
```

On Windows use `python -m venv` and the environment's `Scripts/python.exe`.
The Python runtime and SarPy dependencies are not included in the Electron app.
The small plugin and reader script are bundled and enabled by default.

Set the interpreter in the SICD plugin's `plugin.json`:

```json
"parameters": {
    "python": "/absolute/path/to/.nova-sicd/bin/python"
}
```

In development, edit `src-electron/electron-assets/plugins/sicd/plugin.json`.
For an installed app, copy the bundled `sicd` folder into the user plugins
folder shown by Nova and edit that copy's `plugin.json`. The user copy overrides
the bundled plugin. Restart Nova after configuration.
Use `Scripts/python.exe` on Windows. Paths containing spaces need no extra quoting.
Home-relative paths such as `~/.nova/bin/python3` are also supported. Other shell
expressions and environment-variable references are not expanded.
The bundled value is `python3`; set it to `python` on Windows or to your virtual
environment's absolute interpreter path. If the parameter is omitted, the plugin
tries `python3` (`python` on Windows) on PATH. The former environment variable
and SICD-specific `config.json` are no longer used.
Missing Python or dependencies produces a setup error when opening a SICD;
other image plugins remain available.

## Preview behavior

The plugin reads complex samples with SarPy. The default amplitude preview uses
logarithmic contrast with 1st/99th-percentile clipping. The preview's longest edge
is at most 1600 pixels, sampled with a shared row/column stride to preserve aspect
ratio. Data is read one sampled row at a time, with only the bounded preview held
in memory. Source dimensions are retained for slicing.

## Scaling

**View → Scaling** changes the active image or slice graph. Images update their
preview and percentile statistics; new slices inherit the image's mode. Each
existing graph can also be scaled independently. Image modes are saved in the
scenario; graph windows remain temporary.

| Mode             | Quantity                                                  |
| ---------------- | --------------------------------------------------------- |
| Amplitude        | `abs(I + jQ)`                                             |
| Real / Imaginary | `I` / `Q`                                                 |
| Phase            | `atan2(Q, I)` in degrees                                  |
| Linear power     | `I² + Q²`                                                 |
| Log power        | `10 log10(power)`, reference = one source power unit      |
| Relative power   | `10 log10(power / sampled peak power)`                    |
| RCS              | Pixel power × `Radiometric.RCSSFPoly`, in m² or dBsm      |
| Sigma-zero       | Pixel power × `Radiometric.SigmaZeroSFPoly`, linear or dB |
| Beta-zero        | Pixel power × `Radiometric.BetaZeroSFPoly`, linear or dB  |
| Gamma-zero       | Pixel power × `Radiometric.GammaZeroSFPoly`, linear or dB |

Calibrated modes require their corresponding polynomial, grid spacing, and scene
center pixel coordinates. The polynomial is evaluated in image-plane meters
relative to the scene center, including chip row/column offsets. Unavailable
modes are disabled. Uncalibrated log power is not dBsm.

Relative power uses the peak of the sampled preview or sampled slice, respectively.
Zero power is a gap in logarithmic graphs; phase at zero amplitude is also a gap.
Invalid calibration factors produce gaps rather than misleading values. Previews
map invalid values to black. A percentile contrast stretch maps the selected
quantity to grayscale; graph values and statistics retain the quantity's units.

This remains a quick-look preview, not georectification or a full-resolution tiled
viewer. Samples can alias during subsampling. The worker is terminated after two
minutes and limits captured output to 16 MB. Original image bytes are never modified.

See [SarPy's SICD reader documentation](https://sarpy.readthedocs.io/en/latest/io/complex/sicd.html).

Enable **View → Pixel Values** to inspect exact source samples by hovering over
the image. Values use the selected scaling mode and are accompanied by zero-based
row/column coordinates. Relative power uses the sampled image preview's peak as
its reference. Undefined phase, zero logarithmic power, and invalid samples are
shown as unavailable.

## Image axes

**View → Axes** adds a horizontal X axis (columns) and vertical Y axis (rows).
Values are in image-plane meters relative to the scene center pixel (SCP):
`(local index + FirstRow/FirstCol - SCPPixel.Row/Col) × Grid.Row/Col.SS`.
Cropped images retain their original coordinate origin. Ticks identify pixel
centers and stay aligned with the fitted image when resizing or opening panels.

For `XRGYCR` grids, Y is **Down-range** and X is **Cross-range**. `RGAZIM` and
`RGZERO` use **Down-range** and **Cross-range (azimuth)**. `XCTYAT` keeps
**Cross-track / Along-track** labels; arbitrary grids keep **Row distance /
Column distance**. Nova does not rotate or project the source to relabel these
directions. These are image-plane offsets, not absolute radar ranges or projected
ground distances. See [SICD grid definitions](https://sarpy.readthedocs.io/en/stable/io/complex/sicd_elements/grid.html).

Missing or invalid spacing/scene-center metadata falls back to pixel coordinates.
When Axes and Pixel Values are both enabled, the hover readout also includes the
physical coordinates. Axes can be toggled independently for each image window.

Slice selection strips, selection previews, and graph titles use the same physical
labels. Horizontal slice graphs plot cross-range; vertical slice graphs plot
down-range on range grids. The graph's coordinate axis uses scene-center meters,
with original row/column indices retained in the window title. Without physical
axis metadata, slicing continues to use pixel coordinates.

## SIDD derived imagery

SIDD 1.0, 2.0, and 3.0 products are decoded by SarPy's `SIDDReader`. The plugin
opens the first derived image in a multi-image product and identifies this in
Metadata. Embedded source SICD metadata does not cause the derived pixels to be
interpreted as complex I/Q samples.

- 8-bit monochrome and RGB previews preserve the product's display values.
- 16-bit monochrome previews use a 1st–99th percentile contrast stretch.
- Previews are sampled to at most 1600 pixels per dimension with a shared stride.
- Metadata includes product name, class, classification, pixel type, projection,
  sensor, and collection time when available.
- Statistics and source slices use the original derived intensity, or weighted
  RGB luminance for color products. Slices remain bounded to 4096 samples.
- Pixel Values reads the exact source pixel, independent of preview stretching.
- Plane-projection spacing and reference pixels provide meter axes labeled
  Row distance / Column distance. Other projections fall back to pixel axes.

SIDD pixels are already derived display/intensity data. Complex real/imaginary,
phase, power, and SICD radiometric scaling options remain disabled; Nova does not
infer physical calibration from display values. Image opening, drag and drop,
loading widgets, and scenario restoration work the same way as other images.

Run the reader tests with the configured Python environment:

```sh
python src-electron/sicd-reader.test.py
python src-electron/sidd-reader.test.py
```
