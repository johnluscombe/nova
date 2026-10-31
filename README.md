# Nova (nova)

## Install the dependencies

```bash
pnpm install
# or: yarn/npm/bun install
```

### Start the app in development mode (HMR, error reporting, etc.)

```bash
quasar dev
```

### Format & Lint the files

```bash
pnpm run lint
# or: yarn/npm/bun run lint
```

...or just check formatting & linting:

```bash
pnpm run lint:check
# or: yarn/npm/bun run lint:check
```

### Build the app for production

```bash
quasar build
```

### Customize the configuration

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-file).

### Scenario database

Scenario tables are defined in `src-electron/scenario-schema.ts` with Drizzle's
`sqliteTable` and included in the exported `schema` object. The schema starts
empty; opening an empty `.scenario` SQLite file shows no tables. Only declared
tables are exposed by the browser, even when a file contains other tables.

The Electron process uses Drizzle's release candidate `node:sqlite` adapter.
The Home ribbon has a File group with New, Open, and Close actions.
New prompts for a `.scenario` location and creates the file before opening it.
Canceling or failing to create a file preserves the current scenario.
Open loads an isolated working copy. Image opening requires an active scenario.
Image windows autosave to the scenario: image references, positions, sizes,
stacking order, and minimized/maximized state. Images are reopened through their
plugins; source image files are referenced, not embedded. Missing images or
plugins leave a placeholder window with an error.

Nova reopens the last scenario on startup. Explicitly closing a scenario clears
that startup preference. Layout saves finish before closing or switching
scenarios; save failures are shown in the workspace. Existing empty scenarios
receive the workspace table automatically.
Schema definitions do not create tables; add migrations when adding the first tables.

Run the database tests with `node --test src-electron/scenario-database.test.mjs`.
