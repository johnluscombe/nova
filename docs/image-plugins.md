# Image plugins

Nova ships with raster (JPG/PNG) and vector (SVG) plugins, enabled by default.
Open Image is disabled if no valid plugins load. The main process also rejects image opening without plugins.
No built-in fallback reads or decodes image files.

Additional user plugins live in their own folders under `<userData>/plugins/`:

- macOS: normally `~/Library/Application Support/Nova/plugins/`
- Windows: normally `%APPDATA%/Nova/plugins/`
- Linux: normally `~/.config/Nova/plugins/`

The UI displays the actual directory reported by Electron (development paths can
vary). Copy a plugin folder there and restart Nova. Restart after updating or
removing plugins too; plugins are discovered at application startup. A faulty
plugin is reported separately and does not stop other plugins loading.

Plugins are trusted local JavaScript executing in the Electron main process with
Node.js access. Install only plugins you trust. They are not sandboxed; plugin
errors are caught, but a blocking or crashing decoder can affect the application.

## Structure and API v1

```text
plugins/
  my-decoder/
    plugin.json
    index.mjs
```

```json
{
    "apiVersion": 1,
    "id": "example.decoder",
    "name": "My image decoder",
    "main": "index.mjs",
    "extensions": ["myimage"]
}
```

Use lowercase extensions without a dot. The entry must be an `.mjs` module inside
its plugin folder. IDs must be unique. Dependencies may be bundled or installed
in the plugin's own `node_modules` directory.

```js
export default {
    // Optional. Inspect file contents here when an extension is shared by formats.
    async canOpen(filePath) {
        return true;
    },
    async open(filePath) {
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

`examples/plugins/raster/` remains a reference for user plugins. SICD decoders can
implement the same API; no SICD decoder is included yet.

## Ribbon contributions

Plugins can declare `ribbon.tabs` in `plugin.json`. Each tab contains groups;
each group contains buttons. Contributions use native Quasar controls and text
labels, not plugin HTML or renderer scripts.

```json
{
    "apiVersion": 1,
    "id": "example.tools",
    "name": "Example tools",
    "main": "index.mjs",
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
  and do not enable Open Image. Existing image plugins need no ribbon changes.

The module's default export handles declared button IDs:

```js
export default {
    async executeRibbonAction(actionId, context) {
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
