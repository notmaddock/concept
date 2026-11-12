# Bundle budget

The app is edge-served and optimized for low TTFB, so the initial client
payload must stay small. `pnpm run check:bundle` inspects `dist/client/assets`
after a build and fails when either budget is exceeded:

- **Entry chunk** (`index-*.js`): **400 KiB**.
- **Initial graph**: the entry plus every chunk it references through Vite's
  dependency table and static imports: **1700 KiB**. TanStack Start emits the
  route and its dependencies as sibling chunks that the browser fetches before
  the app renders, so measuring only the entry would miss them.

Run the script for the current numbers; it prints both totals and the largest
initial chunks. `pnpm run validate` and CI run it after the build.

## Lazy-load rule

Heavy feature code loads behind a dynamic `import()` at dialog or decorator
mount. It must not land in the initial graph. Current examples:

- Markdown import/export transformers (`src/lib/documents/import/markdown.ts`,
  `src/lib/documents/export/markdown.ts`).
- Link dialog and floating link editor
  (`src/components/nova/plugins/LinkPlugin/`).
- Document dialogs (`src/components/documents/dialogs/`).

When adding Excalidraw, KaTeX, Mermaid, date pickers, or other heavy
dependencies, name the lazy-load boundary in the PR and re-run
`pnpm run check:bundle`.
