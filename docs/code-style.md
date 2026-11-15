# Code documentation and readability

Use JSDoc for named TypeScript/Vue functions, class methods, and public interface
methods. Use Python docstrings for scientific processing functions and reusable
test fixture helpers. Test names already describe individual test cases; small
inline callbacks need comments only when they carry a non-obvious contract.

Document types and interfaces with JSDoc describing their purpose and ownership.
Add property comments for units, coordinate conventions, sentinel values such as
zero/null, optional capabilities, and persistence or asynchronous lifecycle rules.
Avoid repeating field names or information already obvious from the type.
Separate interface and object-type members with a blank line, keeping each
member's JSDoc directly above that member.

Start with a concise description of what the method does. Add details that help a
caller use it correctly:

- State coordinate conventions and units, including source versus preview pixels,
  zero-based indices, pixel edges versus centers, and physical distances.
- Explain return values such as null, cancellation, detached state, or partial
  results. TypeScript types already describe the shape of parameters and results.
- Document side effects such as file creation, replacing active state, mutation,
  listener registration, and cleanup obligations.
- Describe important failure conditions and limits. Use `@param`, `@returns`, and
  `@throws` when these clarify a public or numerical API.
- Keep implementation rationale near the code it explains, especially asynchronous
  ordering, sampling limits, source-data preservation, and stale-response guards.

Use a blank line between functions and methods, between imports and declarations,
and between logical phases within a method. Separate guard clauses, processing
loops, and returned results. Group related TypeScript variable declarations
without blank lines inside each group. Separate unrelated groups with a blank
line, and keep declarations together before helper functions when initialization
order permits. Add a blank line after imports and between declarations and
functions. Put a blank line between Vue template/script/style sections and CSS rules.
Keep individual CSS properties together. Split long Python conditions, argument lists, and dictionaries across
lines while preserving their evaluation order.

For example:

```ts
/**
 * Convert a zero-based source pixel center to its physical axis coordinate.
 *
 * @param index - Position in the original source grid, not the preview canvas.
 */
function coordinate(origin: number, spacing: number, index: number): number {
    return origin + spacing * index;
}
```

TypeScript, Vue, and styles use the repository's Oxfmt configuration. Run
`npm run lint` to format and apply lint fixes, or `npm run lint:check` to verify
without changes. Oxfmt preserves the blank lines used for logical grouping.

Python files use Ruff formatting with its default 88-character line width. Ruff
is an optional development tool, separate from the scientific plugin's runtime
requirements:

```sh
ruff format src-electron
ruff format --check src-electron
```

After documentation or whitespace changes, run `npm run typecheck`, `npm test`,
and the affected Python tests. Changes spanning the renderer or Electron bridges
should also be checked with `npm run test:e2e`.

## Vue component boundaries

Components are grouped by responsibility under `src/components`:

- `application/`: the ribbon and application settings dialog.
- `workspace/`: workspace coordination, widget windows, and product navigation.
- `image/`: image rendering, axes, and crop/polygon interactions.
- `panels/`: metadata and statistics panels and their content.
- `charts/`: graph rendering.

Keep presentation and local interaction state separate from document and window
coordination:

| Owner                                        | Responsibility                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `IndexPage`                                  | Scenario lifecycle, import progress, persistence, and desktop errors   |
| `ScenarioRibbon`                             | Ribbon layout, contextual tabs, and action intents                     |
| `ImageWorkspace`                             | Window state, selections, and the public workspace controller          |
| `ImageWidget`                                | Window frame, controls, resize handles, and slots for content          |
| `ImageMetadataPanel`, `ImageStatisticsPanel` | Panel rendering and close/selection events                             |
| `ImageSliceView`                             | Image fitting, source coordinate mapping, slices, and pixel inspection |
| `ImageCropOverlay`, `ImageRegionOverlay`     | Local selection drafts and pointer/keyboard interactions               |

The workspace delegates pinned product navigation to `useFormationProducts`,
statistics and stale-response protection to `useImageStatistics`, processing
operations to `useImageProcessing`, and canvas geometry to `useWidgetGestures`.
Children emit intents instead of owning scenario persistence or mutating window
state. Selection overlays receive the viewport's source-coordinate mapper so
image fitting remains consistent across interactions.

`ImageWindow` describes transient runtime state shared by renderers and
composables. `SavedImageWindow` is the narrower persistence contract; new UI state
should be saved only when intentionally added to that contract.
