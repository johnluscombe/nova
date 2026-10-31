# SICD plugin

The bundled `nova.sicd` plugin opens SICD-in-NITF files with `.sicd`, `.nitf`, or
`.ntf` extensions. It uses NGA's SarPy SICDReader in a separate Python process.
Ordinary NITF images without SICD metadata are not supported by this plugin.

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

The plugin reads complex samples with SarPy, displays amplitude (magnitude), and
uses a logarithmic stretch with 1st/99th-percentile clipping. The preview's longest
edge is at most 1600 pixels, sampled with a shared row/column stride to preserve
aspect ratio. Source dimensions are returned for the window status bar. Data is
read one sampled row at a time; complex samples are not all loaded into memory.
Constant nonzero images render mid-gray and invalid or zero samples render black.

This is a quick-look preview, not radiometric calibration, phase visualization,
georectification, or a full-resolution tiled viewer. Samples can alias during
subsampling. The worker is terminated after two minutes and limits captured
output to 16 MB. Original image bytes are never modified.

See [SarPy's SICD reader documentation](https://sarpy.readthedocs.io/en/latest/io/complex/sicd.html).
