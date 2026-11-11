# Bundle budget

The app is edge-served and optimized for low TTFB, so the initial client entry
must stay small. `pnpm run check:bundle` inspects `dist/client/assets` after a
build and fails when the initial entry (`index-*.js`) exceeds **400 KiB**.

Current entry size: **334.5 KiB** (run the script for the exact number after a
build).

## Lazy-load rule

Heavy feature code loads behind a dynamic `import()` at dialog or decorator
mount. It must not land in the initial editor chunk. Current examples:

- Markdown import/export transformers (`src/lib/documents/import/markdown.ts`,
  `src/lib/documents/export/markdown.ts`).
- Link dialog and floating link editor
  (`src/components/nova/plugins/LinkPlugin/`).
- Document dialogs (`src/components/documents/dialogs/`).

When adding Excalidraw, KaTeX, Mermaid, date pickers, or other heavy
dependencies, name the lazy-load boundary in the PR and re-run
`pnpm run check:bundle`.
