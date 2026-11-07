# Document themes

Status: design. Not implemented.

Answers from review (all resolved, see "Resolved questions"):
theme stored in the document (Yjs); chooser disabled on read-only docs; hue
themes follow the app light/dark mode (both palettes ship); chooser = header
button + View menu + ⌘K; View ▸ "Theme" renamed to "Appearance"; theme changes
are undoable; scene backgrounds are static; portals (dialogs/toasts) are themed
too; theme names as proposed.

## Purpose and scope

Add per-document **document themes** that recolor the entire page — the whole
app window, including sidebar, header, the area around the document, and even
portaled dialogs/popovers/toasts — plus the document sheet itself
(`[data-document-sheet]`). Two families:

- **Hue themes**: flat, tonal palettes for each hue already offered as a text or
  highlight color in the format menus and floating toolbar
  (`format-options.ts`, `color-palette.ts`). Each hue ships a **light and a dark
  palette** and follows the app's light/dark mode. Simple: solid page background
  and a contrasting sheet color.
- **Scene themes**: continuous vertical gradients applied **only to the
  document sheet, never to the whole viewport**. The attached mobile screenshot
  (deep blue night gradient) is the inspiration for the `space` scene. Scenes
  are absolute: they pin their own mode regardless of the app light/dark
  setting.

Explicitly out of scope:

- Custom user-authored themes or a theme editor.
- Print/PDF output. `src/styles/print.css` already forces white background and
  black text on the printed content; themes must not leak into print.
- A per-viewer local override on read-only documents (deferred; see Open
  questions).

## Terminology

- **App mode (appearance)**: the existing light/dark/system preference stored in
  `localStorage` under `theme`, applied as a class on `<html>` by
  `theme-provider.tsx`. Renamed in the UI from View ▸ "Theme" to View ▸
  "Appearance". Unchanged mechanically.
- **Document theme**: a per-document palette identified by a string id, stored
  inside the document itself.
- **Page**: the whole app window while a document is open (the theme is applied
  at the `documentElement` level, so portals included).
- **Sheet (document page)**: the `[data-document-sheet]` element that wraps the
  editor. Scene backgrounds are painted here only.

## Decisions

- **The theme id lives in the Yjs document as root state**, exactly like page
  setup (`pageSetupState` in `src/lib/documents/page-setup.ts`). This makes the
  theme sync to Google Drive, realtime collaborators, and `.concept` exports
  through the existing Yjs channels with zero new transport. The alternative —
  `DocumentInfo` metadata or `localStorage` — was rejected because it would be
  local-only: collaborators and other devices would not see the same theme, and
  Drive round-trips would silently drop it.
- **A theme is data, not a CSS class.** The registry is a TypeScript table of
  CSS custom property values; the active palette is applied by setting those
  variables inline on `document.documentElement`. Single source of truth, the
  chooser previews derive from the same table, and tests can assert contrast on
  the raw values. No per-theme stylesheets, no build step.
- **Applied at the document root, so the entire page is themed.** While a
  document workspace is mounted, the plugin sets `data-document-theme="<id>"`
  and the palette's variables inline on `document.documentElement`. Inline
  styles beat the `:root`/`.dark` class values, so everything — sidebar,
  header, page backdrop, sheet, and body-level portals (dialogs, popovers,
  Sonner toasts, devtools) — retints. On unmount (navigating away from `/d/$id`)
  the attribute and variables are removed, restoring the app appearance. The
  landing page is never affected.
- **Hue themes follow the app mode; scenes are absolute.** The registry stores
  a `light` and a `dark` palette per theme. Hue/default themes resolve their
  palette from the app's resolved light/dark mode and re-apply when that mode
  changes. Scene themes pin `mode` (space/dusk = dark, sky = light), use the
  same palette for both, and set `color-scheme` to their mode.
- **Scene backgrounds are applied only to `[data-document-sheet]`**, as an
  inline continuous `linear-gradient`. The page backdrop stays a flat tint from
  the same theme. This is the deliberate divergence from the screenshot, per
  the requirement that the complex background stays on the page (sheet), not
  the viewport. Scene art is static — no animation in v1.
- **Choosers (decided)**: a palette icon button in the document header's
  right-side cluster (next to save/access status — always visible, matches the
  top-right icon placement in the inspiration screenshot) opening a popover
  with a wrapping row of circular swatches; a View ▸ "Document theme" radio
  submenu (same pattern as the existing appearance submenu); and command-palette
  actions for every theme, which come for free once the menu items exist.
  Selection from any surface writes the Yjs root state with a normal editor
  update (with `SKIP_DOM_SELECTION_TAG` so focus isn't stolen), which makes
  theme changes **undoable** with Ctrl+Z, same as page setup.
- **Read-only documents**: the chooser is disabled (menu items and header
  button), same as Page setup. The stored theme still applies for viewing.
- **Visual soundness is enforced by tests**, not by eyeballing: every palette
  of every theme must keep body text at WCAG AA 4.5:1 against both the page
  background and the sheet background, muted text at 4.5:1, and
  primary-on-primary-foreground at 4.5:1. Reuses `contrastRatio` from
  `src/components/nova/plugins/FormatToolbarPlugin/color-contrast.ts`.

## Theme model

New pure-data module `src/lib/documents/document-themes.ts` (node-safe, no DOM):

```ts
type ThemePalette = Record<string, string> // CSS var name -> value

type DocumentTheme = {
  id: string // stored in Yjs; unique
  label: string
  group: 'default' | 'hue' | 'scene'
  /** Scenes pin a mode. Hues/defaults omit it and follow the app mode. */
  mode?: 'light' | 'dark'
  /** Palette per resolved app mode. Scenes repeat the same palette in both. */
  palettes: { light: ThemePalette; dark: ThemePalette }
  /** Optional continuous gradient painted only on [data-document-sheet]. */
  sheetBackground?: { light?: string; dark?: string } // CSS `background`
}
```

Each palette sets the full shadcn-style variable set used by `styles.css`:
`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover(+fg)`,
`--primary(+fg)`, `--secondary(+fg)`, `--muted(+fg)`, `--accent(+fg)`,
`--border`, `--input`, `--ring`, `--destructive(+fg)`, and the eight
`--sidebar*` variables.

- `DEFAULT_DOCUMENT_THEME_ID = 'paper'` — `paper` has empty palettes and no
  `sheetBackground`; applying it just clears the overrides, i.e. today's
  appearance.
- **Hue themes are generated, not hand-written**, by `hueTheme(id, label,
swatchHex, textHex)`:
  1. Convert the toolbar swatch hex (500 shade from `color-palette.ts`) to OKLCH
     and keep its **hue exactly**, so the theme's hue is identical to the
     swatch users already pick for text/highlights.
  2. Build a fixed OKLCH ladder around that hue per mode — light: page ≈
     L 0.955, sheet ≈ L 0.99, primary = the 600-level text color of the same hue
     from `format-options.ts` (strong contrast on light surfaces); dark: page ≈
     L 0.21, sheet ≈ L 0.27, primary = the 500 swatch (readable on dark
     surfaces). Muted/border/secondary/accent/sidebar are low-chroma tints of
     the same hue at fixed steps.
     Because the ladder is fixed, every hue palette is visually sound by
     construction; the contrast tests are the safety net.
- **Scene themes are hand-written** entries with a `sheetBackground`
  continuous-gradient string (see Scene themes).

Resolution helper: `resolveTheme(theme, appMode)` returns
`{ palette, sheetBackground, colorScheme }` where `appMode` is the resolved
('light' | 'dark') app mode — for scenes the pinned `theme.mode` wins.

State, mirroring `page-setup.ts`:

- `src/lib/documents/document-theme.ts`:
  `documentThemeState = createState('documentTheme', { parse })` where `parse`
  returns the id only if it exists in the registry, else `'paper'`;
  `$getDocumentTheme()` / `$setDocumentTheme(id)` on the root node.
- A tiny module-level store (same shape as the save-status store in
  `sync.ts`): `getDocumentTheme(id)`, `subscribeDocumentTheme(id, listener)`,
  and an internal `publishDocumentTheme(id, themeId)` the plugin calls on every
  editor update. The header button and View menu read it with
  `useSyncExternalStore`, so all tabs and collaborators update together.

## Initial catalog

Names as approved. Hue themes derive from the floating-toolbar palette
(Tailwind 500 shades), with light-palette accents from the matching 600 text
color — so theme hues match the text/highlight swatches one-to-one:

| Id         | Label    | Source swatch    | Kind              |
| ---------- | -------- | ---------------- | ----------------- |
| `paper`    | Paper    | — (default)      | default (empty)   |
| `ember`    | Ember    | Red `#ef4444`    | hue, light + dark |
| `sunset`   | Sunset   | Orange `#f97316` | hue, light + dark |
| `honey`    | Honey    | Amber `#f59e0b`  | hue, light + dark |
| `moss`     | Moss     | Green `#22c55e`  | hue, light + dark |
| `lagoon`   | Lagoon   | Cyan `#06b6d4`   | hue, light + dark |
| `ocean`    | Ocean    | Blue `#3b82f6`   | hue, light + dark |
| `iris`     | Iris     | Violet `#8b5cf6` | hue, light + dark |
| `rose`     | Rose     | Pink `#ec4899`   | hue, light + dark |
| `graphite` | Graphite | Gray `#6b7280`   | hue, light + dark |
| `space`    | Space    | —                | scene, dark       |
| `sky`      | Sky      | —                | scene, light      |
| `dusk`     | Dusk     | —                | scene, dark       |

## Scene themes

Scenes set a flat page tint in their palette and put a continuous gradient in
`sheetBackground`, painted only on `[data-document-sheet]`:

- **space** (inspired by the attached screenshot): page = deep navy
  `oklch(0.17 0.05 265)`; sheet =
  `linear-gradient(135deg, oklch(0.17 0.05 265), oklch(0.27 0.08 258), oklch(0.38 0.10 250))`.
  A single continuous night-sky gradient, no stars or glows. Text near-white.
- **sky**: page = pale blue-gray `oklch(0.94 0.02 220)`; sheet =
  `linear-gradient(135deg, oklch(0.78 0.05 220), oklch(0.88 0.035 220), oklch(0.95 0.02 220))`.
  Lighter, low-saturation blues and cyans, no cloud blobs. Dark slate text.
- **dusk**: page = deep plum `oklch(0.20 0.05 330)`; sheet =
  `linear-gradient(135deg, oklch(0.44 0.11 30), oklch(0.36 0.09 355), oklch(0.30 0.07 330))`.
  A softer orange-to-magenta gradient, no blobs. Light text.

Because the sheet is a rounded card on a flat tinted page, scenes read as
"the document page is a window onto the scene", while the chrome around it
stays calm — the complex background never touches the viewport.

## Application mechanics

- `DocumentThemePlugin` mounts inside `Nova` next to `PageSetupPlugin`
  (`src/components/nova/Nova.tsx`). It reads the app mode via `useTheme()`
  (resolving `system` through `matchMedia`) and, on root/update listeners plus
  whenever the resolved app mode changes:
  1. reads `$getDocumentTheme()` and resolves the palette via
     `resolveTheme(theme, resolvedAppMode)`;
  2. sets `data-document-theme` on `document.documentElement` and applies each
     palette variable inline (tracking previously applied names so switching
     themes — including back to `paper` — clears stale ones with
     `setProperty(name, '')`);
  3. sets `style.colorScheme` on `documentElement` to the effective mode
     (scene mode for scenes, app mode otherwise), keeping it consistent with
     `theme-provider`'s own `applyTheme`;
  4. applies `sheetBackground` to
     `editor.getRootElement()?.closest('[data-document-sheet]')` when present
     (clears it otherwise);
  5. publishes the id to the module store so the header button and View menu
     re-render.
     Cleanup on unmount removes the attribute, all inline variables, the sheet
     background, and restores `colorScheme`. Re-runs on document switch because
     `Nova` is keyed by `doc.guid`.
- **Choosing a theme** is a normal editor update with `SKIP_DOM_SELECTION_TAG`:
  `editor.update(() => $setDocumentTheme(id), { tag: SKIP_DOM_SELECTION_TAG })`.
  Being a regular Yjs-backed update, it is undoable (Ctrl+Z) and syncs like any
  edit.
- **Flash of default theme**: the document content is already hidden until the
  session is ready (`ready ? 'contents' : 'hidden'` in `DocumentEditor`), and
  the plugin applies variables in the same update pass, so the sheet never
  paints in the wrong theme. The chrome (sidebar/header) may flash the default
  appearance briefly on first load of a themed document; an optional phase-2
  polish caches the last applied palette per document id in `localStorage` and
  applies it from the blocking boot script (parsing the id from the URL) to
  remove even that flash.
- `DocumentWorkspace.tsx`: add `text-card-foreground` to the sheet div so the
  document can carry its own text color, and add the header button in the
  existing `{document && …}` cluster.

## Chooser UI

- **Header button** (`src/components/documents/theme/DocumentThemeButton.tsx`):
  ghost icon button (`PaletteIcon`, with a small dot showing the active theme's
  page color) in the header's right cluster next to `DocumentSaveStatus` /
  `DocumentAccessStatus`, tooltip "Document theme", disabled on read-only
  documents. Opens a non-modal `Popover` (`finalFocus={false}`, like
  `ColorSwatch`) containing a wrapping row of reasonably large circular
  swatches. Hue/default circles show the page color with a smaller sheet-color
  circle inside; scene circles show their full gradient. Each circle has a
  shadcn tooltip with the theme name and an active ring; there is no visible
  label under the swatch. A horizontal `Separator` puts the scene themes below
  the hue themes. Buttons are `aria-pressed`, labelled by theme name.
- **View menu** (`document-navigation-options.tsx`): the existing `Theme`
  submenu is renamed to **Appearance** (light/dark/system, unchanged behavior,
  same item ids), and a new **Document theme** submenu follows it with radio
  items per theme (`checked` from the store, disabled when read-only). Keywords
  (`theme`, `color`, `background`, each theme label) make every theme
  searchable in the ⌘K palette automatically.
- Selection from any surface goes through one helper that guards read-only and
  performs the `editor.update` above.

## Persistence, sync, export

- Local library, Google Drive, realtime collaboration, and `.concept`
  download/import all carry the Yjs root state, so the theme travels with the
  document everywhere with no new code. Importing an old document simply parses
  to `'paper'`.
- Markdown/HTML/plain-text exports are content-only and unaffected.
- Print is unaffected (`print.css` forces `background: white !important` on the
  printed tree).

## Visual soundness and tests

- New `src/lib/color.ts`: small pure OKLCH→sRGB converter (the same math as
  `oklchToRgb` in `src/components/reui/color-picker.tsx`, extracted so node-env
  tests can use it without a DOM canvas). Registry colors are authored in OKLCH
  to match `styles.css`.
- New `src/lib/documents/document-theme.test.ts` (node project; add the pattern
  to `nodeTestPatterns` in `vitest.config.ts`):
  - `parse` round-trips ids through a real Yjs `Doc` + binding (mirroring
    `page-setup.test.ts`) and falls back to `'paper'` for unknown/garbage ids.
  - Registry invariants: unique ids, `paper` exists with empty palettes, every
    hue theme defines both `light` and `dark` palettes with the full required
    variable set, every scene pins `mode` and has a `sheetBackground`.
  - Contrast: for **every palette of every theme** (scenes repeat theirs, so
    testing both covers them), `contrastRatio(fg, page bg) ≥ 4.5`,
    `contrastRatio(fg, sheet bg) ≥ 4.5`, muted-fg ≥ 4.5 on page and sheet,
    primary vs primary-fg ≥ 4.5. For scene `sheetBackground`s, extract the
    `oklch(...)` gradient stops and assert fg ≥ 4.5:1 against each stop.
- Component test for the chooser (button opens popover, marks the active
  theme, applies on click, disabled when read-only) following the existing
  dialog/popover test style.

## Files

| File                                                                        | Change                                                                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/documents/document-themes.ts`                                      | New. `DocumentTheme` registry, `hueTheme()` builder, catalog, scene backgrounds, `resolveTheme`. Pure data.                             |
| `src/lib/documents/document-theme.ts`                                       | New. `documentThemeState`, `$getDocumentTheme` / `$setDocumentTheme`, `getDocumentTheme` / `subscribeDocumentTheme` store.              |
| `src/lib/color.ts`                                                          | New. Pure OKLCH→sRGB for tests/tooling.                                                                                                 |
| `src/components/documents/theme/DocumentThemePlugin.tsx`                    | New. Applies palette to `documentElement` + sheet background; publishes to store; re-applies on app-mode change. Mounted in `Nova.tsx`. |
| `src/components/documents/theme/DocumentThemeButton.tsx`                    | New. Header button + popover with wrapping circular theme swatches.                                                                     |
| `src/components/nova/Nova.tsx`                                              | Mount `DocumentThemePlugin`.                                                                                                            |
| `src/components/documents/DocumentWorkspace.tsx`                            | `text-card-foreground` on the sheet, header button in the document cluster.                                                             |
| `src/components/documents/navigation-menus/document-navigation-options.tsx` | Rename View ▸ "Theme" to "Appearance"; add View ▸ "Document theme" radio submenu (also feeds ⌘K).                                       |
| `vitest.config.ts`                                                          | Add `src/lib/documents/document-theme.test.ts` to `nodeTestPatterns`.                                                                   |
| `src/lib/documents/document-theme.test.ts`                                  | New. State round-trip, registry invariants, contrast assertions for every palette.                                                      |
| `src/components/documents/theme/DocumentThemeButton.test.tsx`               | New. Chooser interaction test.                                                                                                          |

## Rollout

1. Registry + state + tests (no UI); `paper` everywhere — no visual change.
2. Plugin + header popover; all hue themes (light + dark palettes, following app
   mode) and `paper`.
3. Scene themes (`space`, `sky`, `dusk`).
4. View menu: "Appearance" rename + "Document theme" submenu + ⌘K keywords.

## Resolved questions

| Question                            | Answer                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Where is the theme stored?          | In the document (Yjs root state) — syncs to Drive/collaborators/`.concept`.                     |
| Read-only documents?                | Chooser disabled; stored theme still applies.                                                   |
| Interaction with app light/dark?    | Hue themes follow the app mode (both palettes ship); scenes are absolute.                       |
| Which hue variants ship initially?  | Light + dark pairs for all hues (plus Paper default).                                           |
| Where does the chooser live?        | Header icon button + popover, View ▸ "Document theme" submenu, and ⌘K actions.                  |
| Existing View ▸ "Theme"?            | Renamed to "Appearance"; document themes get their own submenu.                                 |
| Undoable with Ctrl+Z?               | Yes — normal Yjs editor update.                                                                 |
| Animated scenes?                    | No — static, like the screenshot.                                                               |
| Dialogs/popovers/toasts themed too? | Yes — theme applies at `documentElement` while a document is open.                              |
| Theme names?                        | Keep: Paper, Ember, Sunset, Honey, Moss, Lagoon, Ocean, Iris, Rose, Graphite, Space, Sky, Dusk. |

## Open questions

- Read-only viewer override: let a viewer pick a local-only theme (localStorage
  keyed by document id) that doesn't write to the shared document? Useful for
  Drive-shared docs; adds a second source of truth, so deliberately deferred.
- Flash-of-default-theme polish: cache the last applied palette per document in
  `localStorage` and apply it from the boot script (see Application mechanics).
- Should the sheet in `paper` mode also get `text-card-foreground`, or keep
  inheriting `--foreground`? (Decide when wiring the sheet class.)
