# Image plugins

Nova ships with raster (JPG/PNG), vector (SVG), and SICD plugins, enabled by default.
Add Image is disabled if no valid plugins load. The main process also rejects image opening without plugins.
No built-in fallback reads or decodes image files.

Additional user plugins live in their own folders under `<userData>/plugins/`:

- macOS: normally `~/Library/Application Support/Nova/plugins/`
- Windows: normally `%APPDATA%/Nova/plugins/`
- Linux: normally `~/.config/Nova/plugins/`

The UI displays the actual directory reported by Electron (development paths can
vary). Copy a plugin folder there and restart Nova. Restart after updating or
removing plugins too; plugins are discovered at application startup. A faulty
plugin is reported separately and does not stop other plugins loading.

Plugins are trusted local TypeScript modules executing in the Electron main process with
Node.js access. Install only plugins you trust. They are not sandboxed; plugin
errors are caught, but a blocking or crashing decoder can affect the application.

## Structure and API v1

```text
plugins/
  my-decoder/
    plugin.json
    index.ts
```

```json
{
    "apiVersion": 1,
    "id": "example.decoder",
    "name": "My image decoder",
    "main": "index.ts",
    "extensions": ["myimage"]
}
```

Use lowercase extensions without a dot. The entry should be a `.ts` module inside
its plugin folder. TypeScript runs through Electron’s native type stripping; use
erasable syntax and `import type` for type dependencies. Existing external `.mjs`
entries remain supported. IDs must be unique. Dependencies may be bundled or installed
in the plugin's own `node_modules` directory.

```ts
export default {
    // Optional. Inspect file contents here when an extension is shared by formats.
    async canOpen(filePath, parameters) {
        return true;
    },
    async open(filePath, parameters) {
        // All format-specific reads, parsing, decoding, and conversions go here.
        return {
            width: 1024,
            height: 1024,
            previewDataUrl: "data:image/png;base64,..."
        };
    }
};
```

`open` must return an object. Width and height are optional positive safe integers.
The optional preview is a base64 PNG, JPEG, WebP, or SVG data URL under 32 MB.
The host adds the filename, path, and plugin identity and renders the preview.
SVG previews are displayed as images, never injected as inline SVG/HTML.
SVG previews must be self-contained: external linked resources are not loaded.
Plugins can generate reduced previews of large radar datasets. This initial API
returns a preview, not a tiled reader or persistent dataset handle.

User plugins are tried first in folder-name order, followed by bundled plugins.
A valid user plugin with the same ID replaces the bundled plugin; a broken user
plugin leaves the bundled version available. A plugin may decline through
`canOpen`; a failed decoder allows another matching plugin to try. If none can
read the file, Nova reports the error and keeps the previously opened image.
The file dialog and cancellation belong to the host; image file I/O belongs to
the plugin. Scenario SQLite I/O remains separate.

## Bundled plugins

The production plugins live in `src-electron/electron-assets/plugins/` and are
copied into the Electron application by Quasar. They load directly from the app
assets in development and packaged builds; no first-run copy is needed.

- `nova.raster`: JPG, JPEG, PNG. Owns file reads and uses Electron's native decoder
  to produce a reduced PNG preview.
- `nova.vector`: SVG. Reads the file and returns a vector data URL (up to 16 MB),
  preserving sharpness when the image window is resized.

- `nova.sicd`: SICD-in-NITF radar images. Uses a separate Python/SarPy environment
  for bounded grayscale previews. See [SICD setup](sicd-plugin.md).

`examples/plugins/raster/` remains a reference for user plugins.

## Ribbon contributions

Plugins can declare `ribbon.tabs` in `plugin.json`. Each tab contains groups;
each group contains buttons. Contributions use native Quasar controls and text
labels, not plugin HTML or renderer scripts.

```json
{
    "apiVersion": 1,
    "id": "example.tools",
    "name": "Example tools",
    "main": "index.ts",
    "extensions": [],
    "ribbon": {
        "tabs": [
            {
                "id": "home",
                "label": "Home",
                "groups": [
                    {
                        "id": "utilities",
                        "label": "Utilities",
                        "buttons": [
                            {
                                "id": "inspect",
                                "label": "Inspect scenario",
                                "icon": "info",
                                "requiresScenario": true
                            }
                        ]
                    }
                ]
            }
        ]
    }
}
```

- `home` contributes to the built-in Home tab. On Home, group IDs `file` and
  `image` add buttons to the existing groups. Other IDs create additional groups.
- Other tab IDs create plugin-specific tabs. They are namespaced by plugin ID,
  so different plugins can use the same local IDs without colliding.
- Tab IDs must be unique within a plugin, group IDs within a tab, and button IDs
  across the entire plugin. IDs use lowercase letters, numbers, and hyphens and
  start with a letter. Labels are plain text, up to 100 characters.
- `icon` is an optional Material icon name, such as `info` or `folder_open`.
  The default is `extension`; image URLs and HTML are not accepted.
- `requiresScenario` defaults to false. When true, the button is disabled without
  a scenario and Electron also rejects the action without one.
- Empty `extensions` enables ribbon-only plugins, which need no `open` handler
  and do not enable Add Image. Existing image plugins need no ribbon changes.

The module's default export handles declared button IDs:

```ts
export default {
    async executeRibbonAction(actionId, context, parameters) {
        if (actionId === "inspect") {
            return { message: `Scenario: ${context.scenarioPath}` };
        }
        throw new Error("Unknown action");
    }
};
```

The host supplies `context.scenarioPath` (a string or null). Handlers execute in
Electron's main process, serialized with scenario operations; do not block the
main thread with heavy processing. Return nothing, `{}`, or `{ message: "..." }`
to display feedback. Unknown actions, handler errors, and invalid results are
reported in the workspace. These actions do not expose arbitrary IPC channels or
renderer execution. Image plugin handlers can coexist with ribbon handlers.

Copy `examples/plugins/ribbon/` to the user plugins directory and restart Nova
for a runnable example that adds a Home group, an Image button, and a new tab.

## Plugin parameters

Plugins can accept configuration through an optional `parameters` object in
`plugin.json`, for example:

```json
"parameters": {
    "python": "/absolute/path/to/venv/bin/python",
    "previewSize": 1600,
    "enabled": true
}
```

Values may be strings, finite numbers, booleans, or null. Arrays and nested
objects are rejected during discovery. The host passes the frozen object to
`canOpen(filePath, parameters)`, `open(filePath, parameters)`, and
`executeRibbonAction(actionId, context, parameters)`. Plugins without parameters
receive an empty object; existing handlers can ignore the extra argument.
Plugins validate their own parameter names and values. Restart Nova after edits.
For bundled plugins in an installed app, configure a user copy with the same ID.

## Image metadata

Image results may include a `metadata` object mapping display labels to strings,
finite numbers, booleans, or null. For example:

```ts
return {
    width: 1024,
    height: 512,
    metadata: { Collector: "Example", "Row spacing (m)": 0.5 }
};
```

The global View group's Metadata button toggles a panel to the right of the
active widget's image. File details and dimensions are always available; plugin
fields appear when decoding finishes, including when restoring saved widgets.
Metadata is displayed as text. Results allow up to 200 fields, labels up to 200
characters, and string values up to 10,000 characters. Nested objects are rejected.

## Image statistics

The global View group's Statistics button toggles a panel below the active
widget's image, independently of Metadata. Plugins may return a `statistics`
object using the same scalar values and size limits as `metadata`, for example
`{ statistics: { "50th percentile": 2.5 } }`.
Plugins without statistics display an unavailable message.

SICD provides whole-number percentiles from 0 to 100 of finite source amplitudes
before the display stretch, including zeros. The Statistics panel defaults to
the 1st, 5th, 25th, 50th, 75th, 95th, and 99th percentiles. Use Settings in the
ribbon to choose which percentiles are shown; preferences persist across launches
and apply immediately to open images.
Large images use the preview's sampled data, so these are sampled percentiles.
Nonfinite values are excluded. Percentiles are unavailable if no finite samples
exist. Statistics are returned during decoding and scenario restoration without
an additional file read.

## Image slices

The View ribbon group's Slice toggle reveals selection strips at the left and
bottom of the active image widget. Hover on the left strip to preview a horizontal
line; hover on the bottom strip for a vertical line. Click to open a graph of that
line. Letterboxed margins are excluded, so the line tracks the actual image even
when the widget is resized or its side panels are open. Keyboard users can focus
a strip, use arrow keys (Shift for larger steps), and press Enter or Space.
The result appears in a separate movable, resizable, minimizable widget. Graphs
are temporary analysis windows and are not saved in the scenario layout.

Plugins may implement:

```ts
async readSlice(filePath, orientation, index, parameters) {
    return {
        points: [{ position: 0, value: 5 }, { position: 1, value: null }],
        positionLabel: "Column (pixel)",
        valueLabel: "Source amplitude"
    };
}
```

`orientation` is `horizontal` or `vertical`. Samples use increasing, zero-based
positions along the other axis; `null` values create gaps. The host permits slices
only for images previously opened through that plugin, validates indices against
source dimensions, and accepts at most 4,096 finite-or-null samples. Plugins that
provide source slices must return source width and height from `open`.

SICD uses SarPy to read the chosen source row/column and graphs its complex-sample
magnitude before display stretching. Long lines are uniformly sampled to at most
4,096 points; the x-axis retains the original pixel positions. Other plugins use
preview luminance (Rec. 709 RGB weights, 0–255), clearly labeled on the graph.
Preview sampling is limited to 1,600 pixels per dimension, so it represents the
displayed preview rather than full-resolution source intensities. Transparent
preview pixels and nonfinite SICD amplitudes produce gaps.

## Image scaling

Plugins can advertise per-image `scalingOptions` and a current `scaling` in their
`open` result. Supported mode IDs are `amplitude`, `real`, `imaginary`, `phase`,
`power`, `log-power`, `relative-power`, `rcs`, `rcs-db`, `sigma-zero`,
`sigma-zero-db`, `beta-zero`, `beta-zero-db`, `gamma-zero`, and `gamma-zero-db`.
Only advertise modes supported by that file's data and metadata.

The optional third argument of `open(filePath, parameters, scaling?)` requests a
mode. Return the requested `scaling`, updated preview/statistics, and the available
`scalingOptions`. The optional fifth argument of
`readSlice(filePath, orientation, index, parameters, scaling?)` selects the slice
quantity; set `valueLabel` to its name and units. Omitted scaling preserves the
plugin's default behavior. Existing plugins need no changes; Scaling stays disabled
unless capabilities are advertised. The host accepts scaling requests only for
previously opened images and their advertised modes.

See [SICD scaling](sicd-plugin.md#scaling) for the built-in implementation.
