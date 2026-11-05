# Image embedding

Status: implemented in the editor. This document retains the feature contract; the implementation decisions and verification appendix records the chosen policies, established evidence, and remaining service/browser acceptance checks.

## Scope

Add embedded image blocks to Nova using the existing document-scoped asset repository and version 2 `.concept` package format. Images must survive local reload, Drive synchronization, copying a document, portable download/import, and subsequent offline use. Missing backing bytes must preserve the image placement and editable metadata.

The implementation must reuse the generic blob foundation. It must not introduce an image-specific database, separate Drive files, a second uploader, base64 in Yjs, or a requirement for a real-time connection.

Initial scope includes file-picker insertion, image-file paste and drop, block selection/deletion, alt text, proportional resizing, replacement, unavailable states, and explicit export behavior. Inline images, text wrapping, cropping, captions, image links, remote-URL embedding, image editing, and peer binary transfer are deferred. These can extend the node schema and image feature without changing asset identity or package layout.

The related format and transport designs are [blob document format](./blob-document-format.md) and [Drive package transport](./drive-package-transport.md). Where an earlier proposal differs from current code, current code is the integration baseline.

## Existing implementation to reuse

| Module                                                    | Current responsibility                                                                                   | Image integration                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/documents/assets.ts`                             | SHA-256 IDs, byte-derived descriptors, document-scoped durable blobs, deduplication, subscriptions, pins | Store final image bytes through the existing repository                |
| `src/lib/documents/asset-session.ts`                      | `insertDocumentAsset`, resolver state, `createAssetObjectUrl`                                            | Coordinate insertion and render resolved blobs                         |
| `src/lib/documents/working.ts`                            | Repository attachment to Yjs documents, complete snapshot capture                                        | Obtain the active repository through the document session              |
| `src/lib/documents/references.ts`                         | Persisted-node collectors and complete reference discovery                                               | Register the image node's asset field                                  |
| `src/lib/documents/package.ts`                            | Versioned package parsing/writing, integrity, semantic revisions                                         | No image-specific ZIP code                                             |
| `src/lib/documents/sync.ts`                               | Session resolver, missing-asset recovery, `requestUrgentSave`, serialized publication                    | Request saving after insertion; subscribe through the session resolver |
| `src/lib/documents/limits.ts`                             | Generic package budgets and retry policy                                                                 | Apply image-specific budgets in addition to these limits               |
| `src/components/nova/editor.ts`                           | Standalone and collaborative editor extensions                                                           | Register the same image node in both                                   |
| `src/components/nova/plugins/SlashMenuPlugin/options.tsx` | Block insertion menu                                                                                     | Add an Image action backed by the common ingestion path                |
| `src/lib/documents/export/` and `import/`                 | Text, Markdown, HTML conversions                                                                         | Define explicit image conversion and asset transfer                    |

Current MIME normalization recognizes PNG, JPEG, GIF, and WebP signatures, plus PDF as a generic non-image asset. It does not identify SVG or AVIF as supported image types. Signature recognition is not proof that a payload is a valid or safely decodable image.

The existing reference test creates a real Lexical decorator node and synchronizes it through the Yjs binding. Follow that pattern for image contracts rather than fabricating Yjs structures.

## Ownership and invariants

1. The asset ID identifies exact stored bytes; the node identifies one placement of those bytes.
2. Multiple image nodes may share an asset while using different alt text and display sizes.
3. Persist verified bytes before creating a new local reference.
4. A missing or undecodable asset never removes its node automatically.
5. Loading progress, publication status, object URLs, and decoder errors never become persisted node fields.
6. Image arrival changes the view, not the document or undo history.
7. Alt text, display width, and replacement are document edits and participate in collaboration and undo.
8. Normal package exports and Drive saves remain complete; the image feature cannot bypass completeness checks.
9. Every path works without WS/RTC. Publication hints remain an optional transport optimization.
10. Replacing or removing a node does not delete its old asset. Existing conservative retention continues to apply.

## Node model

Implement a block `ImageNode` using a Lexical decorator and a focused React view. Persist these version 1 image-node fields:

```ts
interface SerializedImagePlacement {
  type: 'image'
  version: 1
  assetId: AssetId
  altText: string
  intrinsicWidth: number
  intrinsicHeight: number
  displayWidth: number | null
}
```

This is the feature schema, not a substitute for Lexical's complete serialized-node base type. Extend the installed Lexical types and include its required base fields in the implementation.

`assetId` is required and validated with `isAssetId`. Intrinsic dimensions are positive bounded integers obtained from decoding the stored image, with orientation accounted for. They reserve layout space and provide the natural aspect ratio. `displayWidth` is a positive finite CSS-pixel width or null for automatic natural width constrained to available content width. Do not persist both display width and height for proportional resizing; height derives from the stored aspect ratio.

Intrinsic dimensions are derived metadata duplicated per placement for rendering before asset arrival. They do not authorize decoding, establish asset integrity, or impose a new source of truth for the bytes. If a decoder later disagrees, use a safe local rendering fallback and report a typed decode/metadata problem; do not silently mutate all nodes on every client. Replacement explicitly writes new dimensions.

Use a coherent value for the intrinsic size pair so concurrent replacement cannot leave dimensions from two different assets. The implementation should model asset ID and intrinsic dimensions as one immutable source record, updated atomically by the binding. The flattened schema above describes logical fields; the final persisted representation may use a single validated source value for that record. Keep alt text and display width separate so independent edits can merge without rewriting the source record. Verify the actual Lexical/Yjs behavior in a two-client test before fixing the serialization contract.

Do not add `src`, `uploaded`, a Drive file ID, MIME type, file size, original filename, or a blob URL to the node. MIME and size already belong to the asset descriptor. Avoid persisting local filenames unless a later product feature needs them.

Use typed getters/setters with immutable Lexical updates. Define clone, JSON import/export, text-content fallback, and DOM conversion deliberately. Unsupported node versions must fail compatibility handling without being flattened or dropped on save.

Start with left-aligned block placement. Do not add unused alignment or crop fields in anticipation of future features. Future fields require defaults and explicit node-schema migration, not a package-format rewrite.

## Persisted reference registration

Add a lightweight image schema/collector module that does not import React, image decoding, or DOM APIs. Register the collector against the node's actual persisted type and asset field. For a direct field this uses `registerAssetReferenceCollector('image', node => assetReferenceField(node, '__assetId'))`; if using an atomic source record, implement equivalent strict validation for its nested asset ID.

Finalize the choice based on installed binding behavior, not on assumed field names. A real binding-generated snapshot must demonstrate that the collector discovers exactly the active image references.

Collector registration must happen before package parsing, normalized snapshot capture, semantic revision calculation, or import in every entry point, including non-editor paths. Do not register only in a mounted plugin or unregister it when an editor closes. The current registry rejects duplicate registrations; module initialization must have one deliberate owner, with explicit test setup/teardown and a development hot-reload strategy.

Keep registration independent of `ImageNode` rendering code so package operations do not load the editor UI. Do not expand the generic parser with image-specific tree traversal. Register node support consistently for editable sessions, read-only sessions, imports, and temporary export editors.

## Session bridge and reusable boundaries

Provide a small document-media context outside `src/components/ui/` exposing the current document/session identity, insertion coordination, resolver access, permission checks, and lifetime signal. Image views should not directly query the global `documentSessions` map or depend on Drive APIs.

The workspace owns this bridge because it owns the Yjs document and persistence lifetime. A standalone Nova without an attached asset repository must not pretend to support durable insertion: omit/disable file insertion or receive an explicit local media session. Existing standalone editor usage must continue to work for text.

Suggested cohesive modules:

- A lightweight image schema/reference module for validation and package discovery.
- `ImageNode` for persisted editor semantics and serialization.
- An image ingestion service for accepted bytes, decoding, and insertion preparation.
- An image plugin for commands, picker, paste/drop arbitration, selection, and session coordination.
- A resolver hook/object-URL hook reusable by later media consumers.
- An image block view for available/loading/unavailable rendering.
- Separate resize and metadata controls as the feature grows.

These are responsibility boundaries, not a requirement to create one file for every bullet. Generic hooks must remain media-neutral; image decode policy stays in the image feature.

## Input and validation policy

Initially accept PNG, JPEG, GIF, and WebP if both byte inspection and browser decoding succeed. Preserve the original bytes and animation; do not silently resize, transcode, or strip metadata. Explain this tradeoff in implementation review: preserving bytes also preserves embedded metadata. Sanitization or processing can be added later as an explicit ingestion policy.

Reject SVG, HTML, PDF, unknown payloads, remote URLs, and unsupported image formats from the image insertion action. This does not prevent generic storage of those blobs for another consumer. An `accept` attribute is a picker hint, not validation. Do not trust extensions or `File.type`.

Validate byte size before reading the full payload and before decode. Add named image limits for dimensions, total pixels, concurrent preparations, and files per operation; choose values through device testing before shipping. They must not exceed generic package budgets. Animated payload limits need special attention because a static pixel count does not bound total decoding work.

Inspect image headers for dimension budgets where feasible before full browser decode, then verify the decoded dimensions. Account for EXIF orientation and agree on one orientation policy across natural-size calculation, rendering, and export. Release decoded bitmaps and temporary object URLs on success, failure, and cancellation. Bound preparation concurrency and preserve input order.

The existing repository verifies identity and normalizes media type on storage. Reuse that verification; avoid unnecessary extra full-file hashing just to create the node. Image-specific preflight can inspect bytes and dimensions without introducing a second asset identity system.

## Async insertion and selection

All entry points feed one ingestion coordinator. Capture a logical insertion target before opening a picker or starting async work; do not later insert wherever the user's current caret happens to be.

The target must be resilient to intervening edits: use a validated editor selection bookmark anchored to live node keys, or a Yjs relative position where the integration supports it. A plain DOM Range or serialized character offset is insufficient. Picker actions must not remove selected content until the prepared image can actually be inserted.

When preparation finishes, revalidate document/session identity, cancellation, permission, target existence, and editor editability. If the original target no longer exists, cancel insertion with a clear action result rather than silently appending in another document. The policy for a harmless moved caret is to insert at the captured target without stealing current focus.

Call `insertDocumentAsset` with the active Yjs document, final blob, current `canEdit`, lifetime checks, persistence flush, and `requestUrgentSave` callback. Its callback must synchronously commit the Lexical insertion into the correct bound editor update. It currently wraps the callback in `doc.transact`; that alone does not prove Lexical has synchronized into Yjs before the subsequent flush. Use the installed editor's synchronous/discrete update mechanism and prove ordering in an integration test. If an explicit binding acknowledgement is needed, extend the generic coordinator minimally rather than adding an independent image save pipeline.

Insert a block at the captured position, splitting a text paragraph when appropriate and maintaining a valid trailing text position. Define behavior inside list items and quotes through a shared block-insertion helper; never produce an invalid root or list structure. One inserted image is one undoable action. For multi-file operations, prepare/store accepted files first, then insert successful results in original order as one coherent editor action using a batch-capable coordination path.

Do not hold a Yjs transaction across asynchronous reads or decode. If a flush fails after insertion, retain the visible node and bytes, keep the document dirty, and report the persistence failure once. Do not tell the user that nothing was inserted or retry by inserting another copy. The coordinator needs typed outcomes distinguishing pre-insert failure from post-insert durability failure.

## Entry points

### File picker and slash action

Add an Image action to the existing slash menu and any existing insertion affordance that fits the editor. Reuse installed UI primitives through composition. A picker cancel is silent. The slash trigger is removed according to existing menu behavior without leaving a stale insertion bookmark. Selection survives picker focus changes.

### Paste

Route paste through the selection-wide clipboard pipeline below. Prefer a supported Concept fragment, then rich HTML, then standalone image files, then plain text. A document copied as HTML with image previews must remain a document; the presence of an image file must not discard paragraphs or nested blocks.

Choose one representation for the whole operation and do not also paste its alternative previews. Claim the event and snapshot its data and insertion bookmark synchronously before starting async work. Preserve ordinary rich-text paste through the same importer when supported HTML is present. Unsupported binary-only pastes produce one action-level notification.

### Drop

Differentiate external file drops from the existing editor block-drag feature. Only claim external supported files. Capture the drop location from the editor's selection APIs, not an arbitrary later caret. Preserve file order. Do not interfere with text drops, internal block reorder, or browser handling outside the editor.

### External image URLs and HTML imports

No automatic network fetching of remote `<img src>` or Markdown URLs in the initial implementation. It creates CORS, authentication, privacy, offline, and failure semantics beyond local embedding. Import must return an explicit unsupported-image result or use an intentional alt-text fallback; do not create a fake asset ID or silently claim an image was embedded.

## Rendering and resource lifetime

Resolve each hash through the existing session `DocumentAssetResolver`; use `getState`, `subscribe`, and `resolve`, and respect its immediate subscription callback. Do not fetch Drive from a component or install independent polling per image.

For an available blob, verify that it is an accepted image for rendering, create an object URL through `createAssetObjectUrl`, and render an `<img>` constrained to the content width. Dispose the URL when its blob changes, the asset changes, or the view unmounts. A shared URL cache is optional; start with correct per-view cleanup and only optimize after measurement.

Use the node's stored aspect ratio to reserve space in loading and missing states. Clamp display width at render time to the available page width without writing a resize edit when the viewport changes. Use the existing page/container geometry; do not hardcode paper width. On narrow screens, scale proportionally.

Treat availability and decode success separately. A hash-verified blob can still be an invalid image. A browser decode failure yields an unavailable/unsupported presentation while preserving the reference, not endless automatic Drive downloads of the same bytes.

For missing bytes, render a neutral selectable image placeholder with the stored size/alt text, a concise accessible status, and an explicit retry action when useful. Transient pending states do not show error toasts. Persistent failed user actions use Sonner once, preferably owned by the coordinator/session rather than every placement of the same hash. No duplicated red inline error text.

Read-only sessions render the same image and recovery controls but omit editing controls. Download/retry does not require edit permission; replacement, deletion, alt edits, and resize do. Permission changes mid-gesture cancel the mutation.

## Selection, keyboard behavior, and accessibility

Use Lexical node selection for image blocks. Clicking an image selects it; controls should preserve that selection without unexpectedly moving the text caret. Keyboard navigation can reach, leave, and delete the block using the editor's block-selection conventions. Enter creates or moves to an adjacent text paragraph; Backspace/Delete removes only the selected placement. Test navigation at document boundaries and between consecutive images.

Expose a concise accessible name for the block and labeled actions. Render actual alt text on the image. Empty alt text is permitted for decorative images; do not default it to an internal hash or local filename. Placeholder status must remain understandable when alt text is empty. Do not add focus stops for every noninteractive wrapper.

Provide a focused control for editing alt text and a replacement action. Save alt changes on explicit confirmation or a clearly defined commit boundary, with cancellation and undo support. Do not overwrite another user's alt-text change from a stale form without a documented conflict policy; refresh or indicate that the source changed while the control was open.

## Proportional resizing and replacement

Show resize handles only for the selected editable image. Keep drag preview in local component state. Commit display width once at gesture completion rather than sending Yjs changes on every pointer move. Support pointer cancellation, lost capture, Escape, and permission loss without a commit.

Preserve the intrinsic ratio. Clamp to a usable minimum and current content width, with limits defined in one helper. Provide an accessible keyboard/numeric width control and reset-to-natural-size action; dragging cannot be the only means of resizing.

During a gesture, changes to the node's source or deletion cancel the preview. Define concurrent width edits as the binding's normal conflict resolution for a single field; independent alt edits must not be overwritten. Never rewrite an entire stale node object just to commit width.

Replacement stores and validates the new bytes first, then atomically changes the source record. Preserve alt text and requested display width by default; the new intrinsic ratio determines height. If the target was deleted or replaced again while preparation was running, cancel or require a new explicit action rather than resurrecting it. Compare the expected source/version before committing.

The old bytes remain retained. Undo restores the old source and dimensions without another upload. Source changes are content edits; resolver progress is not.

## Clipboard copy and exports

Portable `.concept` save/export needs no image-specific serialization: the registered collector and asset repository supply the existing package writer. Verify that every image reference is discoverable before enabling the feature.

### Selection-wide copy and paste

Whole-document and mixed-content copy/paste are required initial behavior, including Ctrl+A, Ctrl+C, then Ctrl+V into the same document or another Concept document. Images can appear anywhere the editor schema permits them, including nested list items and quotes. Block-image support does not imply arbitrary nesting inside another image; preserve legal ancestor structure and normalize invalid placement using the same block rules as direct insertion.

Operate on the selected rich-content fragment, not on a list of image nodes. Preserve text, marks, block order, supported ancestors, partial first/last blocks, image placement properties, and the relationship between each image and surrounding content. Copy only selected content and its required assets, not the source document's entire retained inventory, title, page setup, Yjs history, client IDs, or storage metadata.

Use fresh Lexical node keys on paste and the destination's normal binding to create new Yjs items. Do not paste a Yjs update from the source document: that would merge identities/history instead of copying content. Repeated paste creates independent placements while deduplicating immutable bytes.

### Fragment representation and asset discovery

Define a versioned, bounded Concept clipboard fragment consisting of the serialized selected tree, a unique asset table with descriptors and transferable bytes, and an explicit list of unavailable asset IDs. Every reference must be accounted for by one of those two asset collections. Validate consistency before insertion. The fragment is not a `.concept` document and does not need a package-format change.

Recursively discover references through the actual selected serialized tree using typed node adapters. Reuse image schema/reference validation, asset identity, and inventory helpers, but do not feed arbitrary JSON into the current persisted-Yjs collector. That collector has a different input representation. Add an explicit fragment traversal boundary and test both adapters against real editor serialization. Never search arbitrary strings for hashes, inspect only top-level children, or assume each asset appears once.

One asset table entry can back many placements. Each placement retains independent alt text, width, and source dimensions. References in supported nested containers are collected at any depth under explicit depth/node-count limits. Unknown nodes or unsupported required fragment features produce a typed compatibility result; do not silently skip a subtree containing images.

For a string-based custom payload, bytes may be base64 at this clipboard boundary only. Account for encoding overhead in clipboard limits. A browser-supported binary custom clipboard format may be used instead after capability testing. The exact custom MIME spelling and encoding are implementation details; version and validate them independently of document format version 2.

### Producing clipboard data

Capture the selected tree and its asset IDs from one immutable editor state. Read/pin the selected assets while preparing the clipboard representations, then release resources after the write settles. Selection or document changes during preparation must not change what is copied.

Write a self-contained Concept fragment where supported, an interoperable `text/html` representation with embedded data images, and a `text/plain` fallback for the same selection. HTML must preserve the rich tree, not just image tags. Blob URLs and source-local asset IDs alone cannot be the portable representation. The clipboard payload must remain usable after the source closes, the browser reloads, or the source document is deleted. Source document identity is never an authorization token or the sole route to bytes.

Browser clipboard writes have user-activation and async restrictions. The implementation must capability-test custom formats and promise-backed `ClipboardItem` writes on supported browsers. A synchronous copy handler cannot await IndexedDB and then write to the expired clipboard event. Use a bounded prepared representation for synchronous handlers or an activation-preserving asynchronous clipboard write, with explicit preparation/retry behavior where necessary. Do not claim success after writing only a nonportable node payload. Define memory/cache invalidation for any prepared representation and verify native Ctrl+C, not only a toolbar action.

If custom formats are stripped by the browser, self-contained HTML is the portability path. Encode enough bounded, validated placement metadata to restore Concept images from our own HTML, while external apps can still display ordinary image elements. Browser sanitization may remove custom attributes, so ordinary HTML remains usable with documented loss of unsupported placement details. Do not depend on clipboard formats unsupported by the release's browser matrix.

An unavailable source image remains a serialized placement plus an explicit missing-asset record. Its HTML fallback preserves alt text and safe placement metadata without pretending a broken URL is an embedded image. Copy should still preserve the rest of the selection and report unavailable images once when appropriate. Never fabricate bytes, hashes, or a remote source URL.

For cut, remove source content only after successful clipboard publication, and only if the original selection/content is still valid for deletion. A denied/failed clipboard write must leave the source intact. Async changes must not cause cutting the user's later selection.

### Paste precedence and destination commit

Use this precedence for one paste operation:

1. A recognized, supported Concept fragment with its assets.
2. Sanitized rich HTML, preserving surrounding text and supported nesting; ingest bounded embedded data images.
3. Standalone supported image files, when no rich document representation is chosen.
4. Plain text through existing text insertion.

Do not combine the HTML document with its binary image previews. Do not let an ordinary Lexical clipboard format containing only asset IDs take precedence over a complete Concept or HTML representation. A recognized malformed Concept payload must not be silently accepted as valid rich content: fail with one notification, or explicitly offer a less faithful representation. A valid payload from an unsupported future version may fall back to supported HTML with compatibility feedback. Clipboard contents remain untrusted regardless of claimed origin.

The paste coordinator must:

1. Capture the destination bookmark, session lifetime, selection replacement range, and edit permission.
2. Parse and validate the complete selected representation, including all nested nodes and asset references, before changing destination content.
3. Enforce limits on encoded/decoded bytes, assets, node count, tree depth, dimensions, and aggregate work; reject unsafe data URL types and active HTML content.
4. Recompute transferred asset hashes and normalize descriptors; never trust a hash supplied by the clipboard. Reuse existing destination assets after verification or obtain destination ownership through the repository.
5. Persist all supplied assets before inserting any of their references. Preserve explicitly missing source assets as unresolved placements. Missing referenced data without an explicit missing record is an invalid fragment.
6. Revalidate the bookmark and permissions after async preparation, then insert the entire normalized tree in one editor transaction and one undo step. Only now replace the captured destination selection.
7. Flush the bound document and request one urgent save for the completed content operation. Use the existing post-insert durability-failure contract.

A parse, integrity, resource-limit, or storage failure before the commit leaves destination content unchanged. Persisted unused bytes from a cancelled operation may remain under conservative retention; they must not cause partial tree insertion. This atomic rich-fragment behavior differs from standalone multi-file insertion's partial-acceptance policy.

If the source already lacked some bytes, paste the explicit unresolved placements along with the remaining content and show one concise operation result. The destination resolver may find the hash locally or in its own Drive package, but cannot assume the source's Drive file is accessible. Preserve references without promising eventual recovery. The destination's complete-package save remains pending until required bytes are supplied, replaced, or the affected nodes are removed. Offer that recovery path without requiring the source session to remain connected.

### Interoperability boundaries

Same-document paste may reuse existing bytes but must still support a self-contained clipboard representation; optimization cannot become a hidden dependency on the source session. Cross-document paste imports bytes into destination ownership, including offline operation. Cross-tab copy follows the same rules.

For external HTML, accept bounded, supported embedded data images through the same validation/store pipeline, preserving their surrounding content. External remote `<img src>` values remain governed by the no-automatic-fetch policy. Represent them through an explicit alt-text fallback with one operation-level notice; do not drop nearby text, load arbitrary URLs, or turn a URL into a content hash. A clipboard blob URL from another page is not a trusted transferable asset source.

Plain-text clipboard fallback uses image alt-text markers in the correct content position. If the browser cannot publish a complete rich representation within configured limits, communicate the limitation and provide a retry or portable `.concept` transfer path. Never silently downgrade a successful-looking whole-document copy to images alone or text alone.

Current HTML export runs synchronously inside `editor.read` and generates HTML directly. Embedded assets require a two-phase export: capture immutable editor state and image references, resolve/read bytes asynchronously, then serialize from that captured state using a prepared asset-to-data-URL map. Do not await inside a Lexical read/update transaction or export the later live state accidentally. The HTML export's current CSP allows data images. Missing/undecodable required images should fail an image-preserving export once rather than emit broken blob links.

Markdown cannot portably reference package-internal paths in a standalone `.md` download. Initially preserve image alt text in a visible, intentional text fallback and make that lossy behavior explicit in the export action, or defer image-containing Markdown export until a bundled Markdown-plus-assets option exists. Do not emit invalid `assets/<hash>` links without the files. Choose and document one behavior before shipping.

Plain text uses the node's text-content fallback, such as `[Image: description]` or `[Image]` for empty alt text. Do not include hashes or operational statuses. HTML/Markdown import should preserve surrounding content while making unsupported external images explicit; richer conversion is a separate follow-up.

## Synchronization and offline behavior

After durable insertion, request `DocumentSync.requestUrgentSave()` through the session bridge. The generic session serializes publication and handles follow-up saves. Images must not add competing Drive writes or reset the existing debounce machinery independently.

Other clients can receive a reference before backing bytes. Their views subscribe to the resolver; the implemented session handles Drive reconciliation, retry policy, online/focus recovery, and optional publication events. No `uploaded` node state is necessary.

If a complete package arrives without a real-time connection, state and assets are imported through the existing path. If a reference is missing from all currently reachable storage, preserve its placeholder and pending cloud-save state. An image component cannot repair unavailable bytes by retrying continuously.

Local offline availability requires bytes as well as Yjs state. Reuse existing completeness checks; do not mark a document offline-ready after merely decoding its visible images. This feature does not implement the PWA app shell.

## Failure and cancellation contract

| Failure                                         | Expected result                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Unsupported or malformed input                  | No new node; one action-level notification                              |
| Picker cancelled                                | No mutation or notification                                             |
| Blob quota/storage failure before insertion     | No new node; preserve existing content                                  |
| Target deleted/document changed while preparing | Cancel; never insert into another session                               |
| Read-only transition                            | Cancel pending mutation; rendering continues                            |
| Flush fails after insertion                     | Keep node and bytes, dirty state, one durability failure                |
| Missing backing blob                            | Preserve placement; resolver recovery and placeholder                   |
| Valid blob cannot decode                        | Preserve placement; typed render failure, no download loop              |
| Resize interrupted                              | Discard local preview; preserve committed width                         |
| Partial multi-file acceptance                   | Insert successful items in order; one concise result for rejected items |
| Session closes                                  | Abort preparation, unsubscribe, release bitmaps/URLs                    |
| Duplicate payload                               | Reuse asset; create a separate placement                                |

## Implementation plan

1. Fix the persisted image schema and source-record atomicity using real Lexical/Yjs synchronization tests.
2. Add lightweight collector registration to all package entry points and register the node in both editor extensions.
3. Add the document-media session bridge and reusable resolver/object-URL hooks.
4. Implement bounded input validation/decode and single-file insertion with correct flush ordering and typed outcomes.
5. Add block rendering, unavailable states, selection, keyboard behavior, and read-only handling.
6. Add picker/slash, paste/drop arbitration, and ordered batch insertion through the common coordinator.
7. Add alt text, proportional resize, and replacement with cancellation and undo behavior.
8. Implement selection-wide clipboard fragments, recursive asset collection, same/cross-document transfer, browser fallbacks, and explicit text/HTML/Markdown export policies before release.
9. Verify Drive/offline acceptance cases using the existing blob infrastructure rather than introducing another transport.

No direct edits to `src/components/ui/` are needed. Compose installed primitives; add any missing library primitives through the official shadcn CLI using pnpm.

## Verification and acceptance

Node/reference contracts:

- JSON round-trip, clone, invalid IDs/dimensions, unknown node versions, missing source metadata.
- Real binding-generated snapshot discovers the image hash without mounting React.
- Two placements deduplicate bytes while keeping independent presentation state.
- Concurrent replacement does not mix source identity and intrinsic dimensions.
- Concurrent alt/width changes do not overwrite one another through stale whole-node writes.
- Headless package parsing and exporting work before an editor mounts.

Insertion/lifecycle:

- Storage completes before reference insertion; Lexical-to-Yjs synchronization completes before flush/save capture.
- Picker cancellation, moved caret, deleted target, session switch, read-only transition, quota failure, and close during decode.
- Post-insert persistence failure does not insert a duplicate on retry.
- Batch order and partial failures; file/HTML clipboard deduplication; drop does not break existing block dragging.
- Undo/redo of insert, replace, resize, and alt text; no history entries for asset arrival.

Clipboard contracts:

- Partial selections crossing image blocks, deeply nested supported containers, and repeated hashes retain their exact selected structure.
- Rich HTML plus image-file previews yields one rich paste with no duplicate images or discarded text.
- Custom format unavailable/stripped still preserves rich content through self-contained HTML.
- Source edits during async copy do not change the captured fragment; destination edits invalidate or remap the captured bookmark safely.
- Invalid hashes, undeclared references, unsafe data URLs, quota failure, and budget violations leave destination content unchanged.
- Explicit missing-source records preserve placeholders and surrounding content, with pending cloud publication.
- Copy/cut denied by the browser leaves source content intact; successful cut deletes only its validated original selection.
- Native Ctrl+C/Ctrl+V works on supported browsers, including after source closure and without a real-time connection.

Rendering/UI:

- Loading and missing states reserve geometry and recover without edits.
- Object URLs and bitmaps are released on replacement/unmount/cancel.
- Decode errors do not cause repeated Drive fetches or duplicate toasts.
- Narrow viewport, changed page margins, read-only mode, keyboard-only use, empty alt text, and consecutive blocks.

Storage/export acceptance:

1. Insert an image, reload, and display it from local storage with the network disabled.
2. Save to Drive, download `.concept`, import into a fresh session, and display all images without Drive access.
3. Concurrently insert different images on two clients; a later merged package contains both payloads.
4. Deliver a reference before publication and verify eventual rendering with optional real-time messaging disabled or lost.
5. Replace/remove/undo an image and verify old bytes remain usable under retention policy.
6. Copy a whole document containing paragraphs, formatted text, lists, nested quotes, repeated images, and distinct image sizes/alt text. Paste into the same document and a different document, including offline and cross-tab cases. Verify structure/order, independent node identities, one undo step, and deduplicated destination assets. Close/delete the source and reload the destination; images remain available.
7. Export HTML and open it independently offline; no blob URLs or missing backing files remain.
8. Verify explicit Markdown/text behavior without silent image loss or broken links.

Run repository formatting, lint, typecheck, focused behavioral tests, and build after implementation. Browser checks are required for actual decode/orientation, clipboard permissions, pointer interactions, and exports; DOM-only tests cannot establish these contracts.

## Decisions to close during implementation

- Numeric image budgets, animated-image limits, and minimum display width based on target-device measurements.
- Exact persisted source-record representation and headless collector bootstrap location.
- Selection-bookmark mechanism for the installed Lexical/Yjs integration.
- Exact custom clipboard encoding, browser-supported write/preparation mechanism, and aggregate clipboard size/depth budgets. Selection-wide preservation and destination asset ownership are required, not deferred.
- Markdown fallback versus bundled assets; the chosen action must expose any loss before export.

These are bounded image-feature decisions. WS versus RTC, new remote storage, package compaction, media editing, and the PWA app shell remain outside scope.

## Implementation decisions and verification status (2026-11-05)

The proposal above is retained as the acceptance specification. The implementation now adds image nodes, ingestion, document-media sessions, picker/slash/insert actions, image-file paste/drop, editing controls, portable clipboard HTML, and image-aware imports/exports. The evidence below distinguishes automated coverage from browser and service acceptance; it does not mark every acceptance scenario above as verified.

### Persisted contract and lifetime

The final version 1 node stores `source: { assetId, intrinsicWidth, intrinsicHeight }`, `altText`, and `displayWidth`, plus Lexical base fields. Yjs synchronizes the source as one immutable `__source` value; alt text and width remain independent fields. A persisted `__imageVersion` makes unsupported versions fail headless compatibility checks. The built-in collector is initialized in `references.ts`, without importing editor UI, and validates `__source` and `__imageVersion`. Standalone and collaborative editors register the same node.

The workspace editor publishes its media context only after persistence and the session resolver are ready. The context owns cancellation, edit checks, flushing, resolver access, and urgent-save requests. An image operation persists all accepted bytes before its discrete Lexical commit, then flushes and requests saving. The binding owns its Yjs transaction origin: an outer coordinator transaction caused the binding to interpret its own update as remote content and duplicate placements, so the coordinator deliberately does not wrap the callback in another transaction. Image and rich-paste operations use the batch API's explicit post-insert durability outcome; the older single-asset API remains unused by production image call sites.

Insertion bookmarks clone the Lexical selection and retain live node keys with text/child-count guards. A moved caret is harmless; a changed/deleted anchor cancels rather than guessing a new insertion point. Collaborative image edits stop the Yjs undo manager's capture around each discrete operation.

### Input, rendering, and resource budgets

The initial limits are conservative application defaults, not the result of a mobile/device benchmark. Desktop browser smoke testing does not establish a release browser matrix or low-memory-device performance. Further device measurements may justify reducing these values.

| Budget                                | Chosen value                                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| Static image bytes                    | 20 MiB, also bounded by the generic asset limit                  |
| Animated image bytes                  | 8 MiB; GIF conservatively uses this byte budget even when static |
| Intrinsic side length                 | 16,384 pixels                                                    |
| Intrinsic area                        | 40,000,000 pixels                                                |
| Animation frames                      | 100                                                              |
| Aggregate animation frame area        | 160,000,000 pixels                                               |
| Insertion operation bytes             | 64 MiB, also bounded by the generic package limit                |
| Accepted insertion operation area     | 80,000,000 pixels                                                |
| Files per insertion operation         | 16                                                               |
| Concurrent preparations               | 2 across operations and rendering                                |
| Minimum resize control width          | 32 CSS pixels                                                    |
| Clipboard/export transferred bytes    | 32 MiB                                                           |
| Clipboard/export unique assets        | 64                                                               |
| Clipboard tree                        | 10,000 nodes, depth 64                                           |
| Clipboard/export aggregate image area | 80,000,000 pixels                                                |

An operation exceeding the aggregate byte budget is rejected before any payload reads or decode. After preparation, images exceeding the accepted aggregate area are rejected in original input order, while later images that fit can still be accepted. Ingestion inspects signatures rather than filenames or supplied MIME, preflights available PNG/JPEG/GIF/WebP dimension headers and animation records, then requires browser decoding. The stored bytes are preserved exactly, including animation and embedded metadata such as EXIF. This avoids silent conversion or quality loss, but it also preserves location and other embedded metadata; sanitization remains a future explicit processing policy.

Natural dimensions come from the browser's orientation-aware image decoder, and rendering/export use the same original bytes. JPEG header dimensions serve as orientation-independent budget checks; final placement dimensions use decoded orientation. Automated tests exercise an oriented decoder result, but they do not establish real EXIF behavior across browsers. Render resolution independently revalidates supported bytes, decode success, and agreement with placement dimensions before showing the image. A mismatch produces a local typed metadata/decode failure and preserves the node, without mutating source metadata or repeatedly downloading the same bytes. Temporary decode URLs and rendered URLs are released on completion, failure, replacement, and unmount. Cancelled queued preparations are removed immediately.

### Clipboard and export decisions

Copy captures the whole selected Lexical fragment before resolving bytes. The portable encoding is versioned JSON in a `data-concept-fragment` HTML wrapper, with bounded asset data URLs and explicit `null` missing-asset records. Ordinary HTML images also contain self-contained data URLs, so other applications can display them and sanitized HTML can retain content even when Concept metadata is stripped. No custom browser clipboard MIME is required. The handler capability-checks `ClipboardItem` and `navigator.clipboard.write`, starts a promise-backed HTML write within user activation, and reports unsupported or denied writes without deleting cut content. Actual browser support for promise-backed HTML writes still needs matrix verification.

Paste chooses one representation: recognized Concept HTML fragment, otherwise rich HTML, otherwise image files, otherwise normal text. A malformed recognized fragment fails the operation. Supplied bytes are validated, rehashed, and stored under destination ownership before the captured tree is committed. Remote image URLs are not fetched; ordinary HTML import preserves their alt-text fallback and surrounding content with one operation notice.

HTML export captures immutable editor state, resolves assets asynchronously, and emits self-contained data images; missing or invalid required images fail the export. Markdown deliberately uses visible image alt-text markers and exposes the loss in the export action; text uses the same positional markers. Standalone Markdown does not emit package-internal asset links.

### Established automated evidence

Focused tests cover signature rejection, header dimension/animation budgets, decoder orientation results, exact byte preservation, URL cleanup, shared preparation concurrency, and cancellation. Asset-session tests cover persistence before commit, batch storage failure without tree mutation, and a post-commit flush failure retaining the edit and bytes.

Real Lexical/Yjs tests cover JSON/node contracts, reference discovery from binding-generated snapshots, coherent concurrent source replacement, independent alt/width changes, and preservation of edited metadata and replacement source through a fresh persisted-state reload. A mounted bidirectional binding test detects the transaction-origin echo regression, and mounted picker coverage verifies that two selected images create two placements. The media readiness regression explicitly fails with a stable pre-ready context and passes when readiness publishes the context, including reopen.

Rich-paste tests cover complete destination asset storage before tree commit, ordered content without duplicate HTML preview content, integrity failure and quota failure without partial insertion. Fragment validation tests cover explicit missing records. Block-insertion tests cover undoing an ordered image batch in one action; they do not establish the full native rich-clipboard undo scenario. These tests establish editor/storage contracts; simulated decoders and clipboard events do not establish native browser decode, clipboard permission, pointer, or operating-system behavior.

### Remaining service and browser acceptance

Authenticated Drive upload/download, two-account concurrent image insertion, reference-before-publication recovery without real-time transport, fresh offline package import after a Drive round trip, and cross-tab native clipboard transfer after source closure require their acceptance runs. Existing generic package/synchronization infrastructure is reused, but its tests alone do not prove these image-specific service scenarios.

The release browser/device matrix, real EXIF fixtures across browsers, native clipboard permission denial, low-memory animation performance, touch/pointer resize cancellation, and all keyboard/read-only transitions also require explicit browser evidence. Do not infer those outcomes from the DOM test suite.

### Integrated-browser smoke results (2026-11-05)

Tested against the local Vite server with the integrated Chromium browser:

- Insert menu picker and slash-menu click insertion decoded PNG and EXIF-oriented JPEG fixtures. The orientation-6 JPEG reports and renders 80 × 120 from its stored 120 × 80 raster.
- Native image-file paste and rich HTML plus an image-file preview insert one chosen representation, preserving surrounding paragraphs without duplicating the preview.
- Native Ctrl+C/Ctrl+V carries self-contained HTML, full selected content, and images. Same-document and cross-document paste survive destination reload; paste undoes in one step. Copy/paste also works after network access is disabled on the loaded editor.
- Alt text, numeric width, pointer resize, replacement/undo, and keyboard deletion/undo work after a clean page load. Development hot replacement of node classes requires reloading the page before retesting existing node instances.
- A downloaded `.concept` package opens as a fresh local document with all three image placements and edited alt text intact.
- HTML export contains three data-image sources and zero blob URLs. Opened independently, all three images decode, including the oriented JPEG.
- At a 390-pixel viewport, images remain within the content viewport. Temporary offline and viewport overrides were restored after testing.

The browser's file-drop automation API does not expose external drop dispatch; mounted behavioral tests cover that path. Live Drive/two-account recovery, other browser engines, constrained-device performance, and full offline application-shell reload remain outside this smoke evidence. The existing package/storage/sync regression suites pass; no new remote storage or application-shell capability is claimed.
