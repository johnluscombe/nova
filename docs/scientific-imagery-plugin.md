# Scientific Imagery plugin

The bundled **Scientific Imagery** plugin opens SICD and SIDD NITF files with `.sicd`,
`.sidd`, `.nitf`, or `.ntf` extensions. It also opens TIFF images with `.tif` or
`.tiff` extensions using Pillow. It identifies the product from its metadata,
not its extension, using NGA's SarPy readers in a separate Python process. All
formats use the same `parameters.python` interpreter setting. Ordinary NITF files
without SICD or SIDD metadata are not supported.

The plugin retains its internal ID `nova.sicd` so existing scenarios and installed
plugin overrides continue to work. Its bundled folder is `scientific-imagery`.

## Runtime setup

Install Python 3 and create a dedicated environment at a persistent location:

```sh
python3 -m venv "$HOME/.nova-scientific-imagery"
"$HOME/.nova-scientific-imagery/bin/python" -m pip install -r src-electron/electron-assets/plugins/scientific-imagery/requirements.txt
```

On Windows use `python -m venv` and the environment's `Scripts/python.exe`.
The Python runtime and SarPy dependencies are not included in the Electron app.
The small plugin and reader script are bundled and enabled by default.

Set the interpreter in the Scientific Imagery plugin's `plugin.json`:

```json
"parameters": {
    "python": "/absolute/path/to/.nova-scientific-imagery/bin/python"
}
```

In development, edit `src-electron/electron-assets/plugins/scientific-imagery/plugin.json`.
For an installed app, copy the bundled `scientific-imagery` folder into the user plugins
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

**Scientific Imagery → Analysis → Scaling** changes the active image or slice graph. Images update their
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

## TIFF images

The same plugin opens `.tif` and `.tiff` files using Pillow in the configured
Python environment. Install or update its `requirements.txt` to include Pillow.
Supported image modes include 8/16-bit grayscale, signed and floating-point
intensity, RGB/RGBA, palette, and monochrome images. Standard uncompressed, LZW,
PackBits, and Deflate TIFF files are covered by tests.

8-bit and color previews preserve display values and transparency. Higher-depth
intensity previews use a percentile contrast stretch, while statistics, slices,
and pixel inspection retain original source values. Color inspection uses RGB
luminance; fully transparent pixels have no value. Previews and slices use the
same sample limits as the radar formats. Pillow may decode the full source image
internally, so source decoding memory depends on the TIFF size and compression.

Multi-page TIFF files open the first page, identified in Metadata. Axes use pixel
coordinates; GeoTIFF georeferencing is not interpreted. Complex scaling remains
disabled. Files work with Add Image, drag and drop, and scenario restoration.

```sh
python src-electron/tiff-reader.test.py
```

### Large TIFF pixel limit

Scientific Imagery allows up to **1,000,000,000 pixels** per TIFF page by default,
replacing Pillow's smaller decompression-bomb threshold. To change it, set the
plugin parameter and restart Nova:

```json
{
    "parameters": {
        "python": "/path/to/your/python3",
        "maxTiffPixels": 2000000000
    }
}
```

`maxTiffPixels` is a nonnegative integer measuring width × height, not file size.
Set it to `0` to remove the limit for TIFF files you trust. The limit is checked
before pixel decoding and applies to previews, source slices, pixel inspection,
and scenario restoration. This does not change the 1600-pixel preview limit.
Pillow can still decode the full TIFF internally, so larger files require more
memory even when their preview is small.

## CPHD phase history

Open `.cphd` files through Add Image, drag and drop, or ZIP import. The first channel
is displayed as a complex phase-history matrix: rows are vectors and columns are
samples. This is not a formed SAR image. Axes show zero-based Vector and Sample
indices, not down-range or cross-range distances. The metadata panel identifies
the channel, signal format, and domain when available.

Amplitude, real, imaginary, phase, linear power, log power, and relative power are
available, together with source pixel values, slices, and polygon percentiles.
RCS and other image radiometric calibrations are unavailable for CPHD. SarPy's
formatted complex samples include its supported per-vector amplitude scaling.
Previews and statistics use the same bounded sampling as SICD previews. CPHD uses
the existing Python interpreter and SarPy installation; no extra dependency is needed.

## Forming a SICD from CPHD

Open a CPHD, select its image window, then choose **Scientific Imagery → Data →
Form SICD**. A new widget opens immediately while CPU backprojection runs. The
source phase history stays open. Completed products are stored under Nova's
application-data `formed-images` directory and reopen with the saved scenario.
The source and existing products are never overwritten.

Configure **Home → Settings → CPHD image formation** before starting:

- **Algorithm:** CPU backprojection, the initially supported algorithm.
- **Output size:** 64, 128, 256, or 512 pixels per side.
- **Pixel spacing:** meters, or zero to choose spacing from the selected aperture's
  sampled spatial bandwidth. Coarse spacing that would alias that bandwidth is rejected.
- **Maximum aperture vectors:** 8–4096 contiguous vectors centered on the first
  channel. A longer aperture can improve cross-range resolution but increases runtime.
- **Window:** Hann reduces sidelobes; uniform preserves the unapodized response.

The first implementation supports uncompressed, monostatic **FX-domain CPHD 1.x**
with finite sample coordinates, frequency support, antenna positions, scene
reference positions, and increasing pulse times. It forms a square image on the
local WGS-84 tangent plane at the IARP. It uses each vector's frequency grid and
reference point, respects frequency support and phase sign, and reads one signal
vector at a time. Output must fit the unambiguous delay interval. Formation has a
ten-minute timeout; reduce aperture length or image size if needed.

The result retains complex values in `RE32F_IM32F` SICD/NITF with physical grid
spacing, scene corners, a fitted monostatic trajectory, source classification,
and processing provenance. Metadata is checked against the SICD XML schema before
writing. Backprojection is represented as `ImageFormAlgo=OTHER`; some tools,
including SarPy's detailed consistency checker, flag all OTHER algorithms because
they cannot validate their image-formation model.

This is an experimental image former with synthetic point-target validation.
Output is **uncalibrated** and does not perform autofocus, terrain correction, or
SIDD generation. Source amplitude scaling is applied by SarPy, but no RCS or
sigma-zero calibration is inferred. Validate results against a trusted image
former before quantitative use. TOA-domain and bistatic collections are rejected.

Image formation additionally requires `lxml`; reinstall this plugin's
`requirements.txt` in the configured Python environment if it is missing.

### Formation product slides

Selecting a newly formed SICD opens a slide navigator on the left of the workspace.
It remains available when other windows are active and includes:

1. Input phase history from the selected aperture.
2. Windowed phase history with frequency support and aperture weights applied.
3. Range-compressed profiles on a shared relative-delay grid.
4. Partial coherent images after 25%, 50%, and 75% of the aperture.
5. The final uncalibrated SICD.

Click a thumbnail, or use arrow keys and Home/End, to open a product in its own
window. Selecting an already open product brings that window forward; the final
SICD remains unchanged. Activating another formation set updates the navigator. Close the
navigator with its × control; the current image stays open. Use the Formation
products tab on the left edge to reopen it with the same selected slide. Diagnostic
windows display their product image without captions. They are bounded,
display-only log-amplitude previews with independent contrast stretching; they
are not calibrated data products. Image analysis controls apply to the final SICD
and are disabled while an intermediate slide is displayed.

Previews are stored in `<image>.sicd.formation.json` alongside the generated SICD.
Keep that file with the image when moving it. Open product windows are saved in the
scenario. Existing SICDs without a preview file continue to open normally;
regenerate a product to obtain its intermediate slides. A missing or corrupt
preview file does not prevent the final image from opening.
