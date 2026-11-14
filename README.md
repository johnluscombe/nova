<img src="public/icons/nova-128.png" alt="Nova icon" width="96" height="96" />

# Nova

[![Build and tests](https://github.com/johnluscombe/nova/actions/workflows/ci.yml/badge.svg)](https://github.com/johnluscombe/nova/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjohnluscombe%2Fnova%2Fcoverage%2Fcoverage.json)](https://github.com/johnluscombe/nova/actions/workflows/ci.yml)

An Electron workspace for radar imagery, built with Vue, Quasar, and SQLite.

![Nova workspace displaying a synthetic radar image with metadata and percentile statistics](docs/images/nova-workspace.png)

_Nova displaying synthetic SICD radar data with the Metadata and Statistics panels open._

## Development

```sh
npm install
npm run dev
```

Use Node.js 24 or newer. Electron dependencies are installed in `src-electron`
by Quasar when running or building the app.

```sh
npm run build       # Package the Electron app
npm run typecheck
npm run lint:check
npm test            # Vitest unit tests
npm run test:e2e    # Build and test Electron with Playwright
npm run test:coverage:all
```

Combined coverage is available at `coverage/combined/index.html`.
See [testing and coverage](docs/testing.md) for setup and reporting details.

## Scenarios and images

Create or open a `.scenario` SQLite file from the File ribbon group. Image widgets
autosave their file references, positions, sizes, and window states. Nova restores
the last scenario on startup; explicitly closing it clears that preference.
Source images remain separate from the scenario file.

Drag a `.scenario` file into Nova to open it, or drop images into an open scenario
to create image widgets. Multiple images can be dropped together. When dropping
a scenario and images together, Nova opens the scenario first.

Bundled plugins support raster images, SVG, and SICD-in-NITF radar imagery.
See [image plugins](docs/image-plugins.md) and [SICD setup](docs/sicd-plugin.md).
The Settings dialog configures the amplitude percentiles displayed in Statistics.

Application and test sources use TypeScript. Plugins use Electron's native type
stripping and must use erasable TypeScript syntax. Scenario schema definitions
live in `src-electron/scenario-schema.ts`.

Enable Slice in the View ribbon group to reveal selection strips on the left and
bottom of the image. Hover over the left strip to preview a horizontal slice, or
the bottom strip for a vertical slice; click to open its graph. SICD plots source amplitude; other formats plot preview luminance.
Graphs open as independent temporary widgets and are not saved to scenarios.
