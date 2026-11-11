## Summary

<!-- What changed and why. Link the roadmap task (P0.x/P1.x/P2.x) when applicable. -->

## Node feature checklist

Complete this when adding or changing an editor node type.

- [ ] `src/lib/documents/references.ts`: reference-free entry or asset collector (with version check).
- [ ] `src/lib/documents/package.ts`: feature entry when the node needs a capability gate; migration story for documents saved without it.
- [ ] Import and export: registered in `src/components/nova/node-registry.ts`, Markdown/HTML round-trip covered, unsupported constructs reported.
- [ ] Theme: `src/components/nova/theme.ts` class (and print rule if the node renders differently in print).
- [ ] Accessibility: keyboard path, labels, and focus behavior.
- [ ] Collaboration: Yjs shape is small and stable; no large decorator JSON blobs.
- [ ] Lazy-load boundary: heavy feature code behind dynamic `import()` at dialog/decorator mount.
- [ ] Save/reopen a document containing the node (and a document saved before the node existed).

## Verification

- [ ] `pnpm run validate`
- [ ] `pnpm run check:bundle` (when touching editor code)
- [ ] Manual check for visible editor changes
