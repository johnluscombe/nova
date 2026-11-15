# Testing

- `npm test` runs the TypeScript unit tests with Vitest.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run test:e2e` builds the Electron app without packaging and runs Playwright.
- `npm run test:e2e:ui` opens Playwright's UI using the last build. Run
  `npm run test:e2e` first, or rebuild with `npx quasar build -m electron --skip-pkg`.

Playwright uses the Electron executable installed in `src-electron`; no browser
installation is needed. A desktop session is required (use `xvfb-run` on headless
Linux). Tests use a temporary user profile and scenario, stub native file dialogs,
and remove their profile afterward. End-to-end tests cover scenario creation and reopening, loading widgets,
metadata and statistics, movement and resizing, ribbon contributions, canceled
dialogs, missing images, and save failures. Test plugins run inside the real
Electron process and use release files to control slow decoding deterministically.
Failure traces are stored under `test-results/`.

Python unit tests live in `tests/unit/python/`. They run separately from Vitest
because they require the scientific imagery plugin's Python environment:
`<venv>/bin/python tests/unit/python/sicd-reader.test.py`.

### Istanbul coverage

- `npm run test:coverage` generates unit reports in `coverage/unit/`.
- `npm run test:e2e:coverage` builds an instrumented Electron renderer, runs
  Playwright, and generates reports in `coverage/playwright/`.

Each directory contains `index.html` and `lcov.info`. The JSON reports are
`coverage/unit/coverage-final.json` and
`coverage/playwright/coverage-playwright.json`. Coverage summaries also appear in the terminal. Reports are ignored by Git.

Unit coverage includes TypeScript application logic, TypeScript image plugins,
and Vue components. Vue unit tests use jsdom and stub native IPC/Quasar controls.
Electron main/preload entrypoints remain outside its scope.
Playwright coverage measures renderer files loaded by the tests, including Vue
components, and maps results back to original sources. It does not currently
measure Electron main/preload, plugin subprocesses, or Python. The two reports
have different scopes; the combined report takes the union of their files.

Instrumentation is enabled only by `NOVA_COVERAGE=1` during the coverage build.
Normal development and production builds do not include coverage instrumentation.
Coverage is collected before the test app closes, including on test failures;
missing instrumentation fails the coverage run instead of producing an empty
report. Playwright raw data is cleared for each run, merged across tests, and kept
in `coverage/playwright/raw/` for inspection.

### Combined coverage

`npm run test:coverage:all` runs both suites with coverage and generates a single
Istanbul report in `coverage/combined/` using `nyc merge` and `nyc report`. The final summary’s **Lines**
percentage is the single overall metric. Shared files are merged by source path:
a line covered by either suite is covered in the combined report. Percentages
are computed from merged counts, not averaged between suites.

Open `coverage/combined/index.html` for details. `coverage-summary.json` contains
`total.lines.pct` for CI, alongside statement, function, and branch summaries.
LCOV and the merged raw JSON are also generated. Electron main/preload and Python
remain outside the combined scope.

`npm run coverage:merge` merges existing unit and Playwright reports without
rerunning tests. Use it only for reports from the same checkout; use
`npm run test:coverage:all` to generate fresh reports together. Both input reports
must be present. The full command stops if either suite fails. File staging uses `shx` for
cross-platform npm scripts; `nyc merge` and `nyc report` perform the merge and
report generation directly.

The Playwright coverage reporter optionally accepts an existing Istanbul JSON
file instead of merging its default `coverage/playwright/raw/*.json` inputs:

```ts
reporter: [
    ["list"],
    [
        "./tests/e2e/coverage-reporter.ts",
        { rawInputFile: "artifacts/coverage.json" }
    ]
];
```

Relative paths resolve from the working directory. Custom input is preserved at
startup and must exist by the end of the run. Reports still go to
`coverage/playwright/`. This setting changes the reporter's input; it does not
change where `collectCoverage` writes its per-window files.

All Electron specs should import `test` and `expect` from `./fixtures` rather than
`@playwright/test`. The shared automatic `application` fixture launches an isolated
app per test and collects coverage before closing it, including on failures. The
`profile` fixture supplies the temporary directory and removes it after app
teardown. Specs can access them with `async ({ application, profile }) => { ... }`;
no per-spec coverage hooks are needed.

Playwright suites are organized as named `projects` in `playwright.config.ts`.
The `e2e` project discovers `tests/e2e/**/*.spec.ts`; e2e npm commands explicitly
select `--project=e2e`. Future component tests can use a separate project and test
directory without being picked up by the Electron suite. Component tests will
also need their own component-testing setup and fixtures.

Coverage instrumentation lives in `tests/coverage/instrumentation.ts`. It passes
Vite's combined source map directly to Istanbul, preserving original Vue SFC
locations. A regression test verifies that generated line 1 remaps to original
line 5 before merging. Avoid replacing those maps with identity maps: that makes
unit and e2e coverage refer to different lines in the same Vue source file.

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`, and supports
manual dispatch. The macOS job installs both npm lockfiles, checks types and lint,
runs Python/SarPy tests, and runs the combined Vitest/Playwright coverage command.
It then builds and uploads an unsigned macOS app archive. Download `Nova-macos`
from a successful Actions run; the archive preserves app permissions and symlinks.

The Actions summary displays coverage percentages. The `combined-coverage`
artifact contains the HTML, LCOV, JSON, and summary reports; failed runs also
upload available Playwright traces. Artifacts expire after 14 days (failure
traces after 7 days).

After all checks and packaging succeed on `main`, a separate job uses the built-in
`GITHUB_TOKEN` to create/update the `coverage` branch with a Shields-compatible
`coverage.json` and `coverage-summary.json`. The README badge uses combined
**line coverage**, including unit and renderer e2e results. No personal token,
external coverage account, or GitHub Pages setup is needed. The first successful
main-branch run initializes the badge. Fork PRs never publish badge data; test
jobs have read-only repository permissions. Repository/org policy must allow
the publishing job's `contents: write` permission.

The macOS package is unsigned; this workflow does not sign, notarize, or publish a
release. Windows and Linux installers are not produced by this workflow.
