# Blob support in the Concept document format

Status: implemented blob foundation. Image nodes and image rendering remain separate consumer work.

## Implementation decisions and validation

- `src/lib/documents/limits.ts` owns customizable defaults: 100 MiB package, 256 MiB expanded total, 50 MiB asset, 32 MiB Yjs update, 1 MiB manifest, 2,048 entries, 100× expansion ratio, and two concurrent repository hash jobs. Missing-asset checks start at 15 seconds with jitter and back off to five minutes; hidden and offline tabs pause automatic checks.
- The codec uses MIT-licensed `fflate` for stored ZIP output and bounded chunked inflation. A structural preflight validates local and central ZIP records before decompression. The initial writer stores all entries to bound processing and avoid recompressing assets.
- Recovery import is exposed as an explicit local-copy choice. Verified assets and references survive; missing inventory IDs persist outside Yjs and block normal package writes until repaired. Staged imports remain hidden until local flush succeeds.
- Dirty revisions use captured Yjs bytes and trusted descriptors, without reading blob bytes. Complete snapshots independently verify inventory for publication and export.
- Drive uses binary conditional multipart uploads. See [transport evaluation](drive-package-transport.md) for MIME transitions, resumable-upload tradeoffs, and the live-account rollout checks that remain.
- Local BroadcastChannel publication hints are optional. Missing-asset reconciliation works without the adapter, and asset payloads are never sent through the collaboration transport.
- Offline availability means persisted document state and every required asset; complete-package import additionally retains the entire verified package inventory. This does not provide an offline app shell.
- Automated coverage includes package validation, real binding-generated reference discovery, local asset lifecycle, explicit recovery, acknowledgement races, conflict inventory union, lost upload responses, polling without hints, and stopped sessions. The localhost smoke test verified editing, reload, ZIP download, and independent import with Unicode text.

The original design below remains the contract for future asset consumers. Image type acceptance, pixel budgets, decoding, and original-image retention belong to that future feature. Live Drive account validation of MIME transitions and shared-file permissions is required before rollout; automated adapter coverage does not replace it.

## Purpose and scope

Extend Concept documents to contain arbitrary immutable binary assets. Images are the first consumer, but the storage, package, validation, and synchronization layers must also support future attachments, audio, drawing resources, and other binary content without image-specific branches.

The `.concept` file becomes a versioned ZIP package containing a Yjs snapshot and binary assets. ZIP is the portable and Drive persistence representation. The live editor continues to work with Yjs and a separate local blob store.

Google Drive remains the durable remote storage location. Every successfully published package is self-contained. No new application-hosted asset storage is introduced. WebSocket and WebRTC connections are optional; opening, editing, saving, recovering missing assets, and working offline must not depend on them.

This design specifies the blob foundation and the integration contracts an image node will consume. It does not specify image toolbars, resizing interactions, layout, cropping, media transcoding, a collaboration server, or a choice between WebSocket and WebRTC.

## Decisions

- Identify an asset by the SHA-256 digest of its exact stored bytes.
- Store assets separately from Yjs locally, as binary blobs.
- Store references and editable presentation properties in Yjs.
- Package Yjs state, an asset manifest, and binary entries into a single `.concept` ZIP.
- Generate the manifest for each captured package; never edit or merge it as a second source of document state.
- Preserve nodes whose assets are unavailable. Missing bytes are a valid live state.
- Publish only complete packages through normal save and export paths.
- Prioritize a Drive save when an asset is inserted, through the serialized save queue.
- Use optional publication notifications to accelerate reconciliation after a successful upload. Do not add an `uploaded` property to content nodes.
- Recover through Drive reconciliation even when notifications are absent or lost.
- Do not send asset bytes over RTC or WS in the initial implementation.
- Retain assets conservatively. Automatic destructive compaction requires a separate retention design.

## Current implementation and migration surface

The current format is version 1 JSON. `src/lib/documents/serialization.ts` encodes the full Yjs update as base64 along with the document name, format identifier, and origin. `src/lib/documents/concept-file.ts` parses that JSON, checks that the Yjs snapshot contains a root, imports it, and exports it.

`src/lib/documents/sync.ts` treats serialized strings as snapshots, compares them for dirty state, hashes them through `revision.ts`, merges downloaded Yjs state, and acknowledges only the snapshot actually uploaded. That last property must survive this change.

`src/lib/documents/drive/api.ts` currently reads media with `response.text()` and builds multipart uploads from strings. It binds downloaded content to a stable ETag with metadata checks before and after downloading. Updates use `If-Match`. Preserve those concurrency protections while moving media transport to binary data.

`src/lib/documents/transfer.ts` and the save-provider contracts expose parsed version 1 files. They must accept a normalized document snapshot plus assets rather than baking the old JSON schema into every provider.

`src/lib/documents/storages/local.ts` manages local metadata and Yjs persistence. Blob ownership, durable flushes, deletion, and lifecycle locking must integrate with it. `local-provider.ts` carries Yjs updates and awareness through BroadcastChannel; it does not currently transport external assets.

Current Drive synchronization reacts to opening, local changes, focus, online events, authentication recovery, and retries. An unresolved asset also needs bounded periodic reconciliation while the document is actively open; focus events alone do not resolve the case where an upload completes while the receiver stays focused.

## Terminology and invariants

An **asset** is immutable bytes addressed by a content hash. A **reference** is document state pointing to an asset. A **missing asset** means a reference exists but the client cannot obtain verified backing bytes. This includes a pending upload, a stale local package, eviction, and a broken document. An **unreferenced asset** is bytes retained without a current visible reference. These are different conditions and need different handling.

A **package** is one frozen document snapshot and its included asset collection. A **publication** is a successful remote write of a complete package. A **local save** is durable local document and asset persistence; it is distinct from a Drive publication.

Required invariants:

1. The same asset ID always means the same bytes. Existing asset contents cannot be overwritten with different bytes.
2. A reference does not imply local availability, remote availability, or authorization to retrieve bytes.
3. A successful normal package write contains every required asset in its captured snapshot.
4. A new remote snapshot merges into the live Yjs document; it never replaces unsaved local edits.
5. A package manifest describes that package only. It does not constrain references introduced by later Yjs updates.
6. Asset arrival changes local availability without creating a content edit.
7. Only the captured uploaded snapshot becomes acknowledged. Later edits remain dirty.
8. Neither transient network absence nor a missing asset deletes a node.
9. Retained assets from a downloaded package are preserved across ordinary saves, including conflict retries.
10. Every operation remains correct with no real-time transport.

## Asset identity and metadata ownership

Use lowercase hexadecimal SHA-256, represented externally as `sha256:<64 lowercase hex characters>`. A ZIP entry uses only the digest: `assets/<64 lowercase hex characters>`. Fix the algorithm for format version 2; additional algorithms require an explicit future format capability.

Hash bytes after any deliberate processing. If an image is resized or transcoded before insertion, the processed output is the asset. The original is a separate asset only if a feature explicitly retains it. Replacing bytes always creates a different asset ID.

Hashes deduplicate byte-identical content, not visually similar images. A hash verifies integrity; it does not establish trust or grant access.

| Information                                              | Owner                             | Rationale                                              |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| Placement, asset reference, alt text, display dimensions | Yjs consumer node                 | Editable, placement-specific document content          |
| Binary payload                                           | Asset store                       | Immutable data, independently cached and persisted     |
| MIME type and byte length                                | Validated asset descriptor        | Shared properties of the stored payload                |
| Optional intrinsic image dimensions                      | Media metadata derived from bytes | Consumer optimization, not generic blob infrastructure |
| Included entries and their descriptors                   | Package manifest                  | Inventory of one frozen package                        |
| Download/upload progress, retry state, object URL        | Local runtime                     | Device-specific and transient                          |
| Drive ETag and last acknowledged revision                | Storage session metadata          | Specific to one storage destination                    |

A node should reference only the asset ID plus its own properties. MIME and byte length do not need to be duplicated on every node. A renderer with a missing blob must tolerate descriptor absence too. Presentation dimensions can reserve space before bytes arrive.

MIME type is not part of identity. Equivalent bytes cannot create separate records merely because two clients provide different type strings. Validate supported types against bytes where practical; use `application/octet-stream` for unknown generic payloads. Conflicting descriptors must be normalized by one deterministic policy, not arbitrary last-writer overwrites. Never trust a declared MIME type to permit active content execution.

## Package layout and schema

```text
manifest.json
document.yjs
assets/<digest-a>
assets/<digest-b>
```

Asset entry names contain the full lowercase digest, without a file extension.

Proposed manifest shape:

```ts
interface PackageManifestV2 {
  format: 'concept'
  version: 2
  origin: 'Concept'
  name: string
  document: {
    path: 'document.yjs'
    encoding: 'yjs-update-v1'
    sha256: string
    byteLength: number
  }
  assets: Array<{
    id: string
    path: string
    mediaType: string
    byteLength: number
  }>
  requiredFeatures: Array<string>
}
```

This is a schema proposal, not a new implementation API. Validate IDs, fixed paths, nonnegative safe integer lengths, supported versions, bounded strings and collection sizes, and unique entries. The document hash uses the same digest representation as asset IDs. The document encoding explicitly refers to Yjs update encoding, independently of the Concept format version.

`name` is a portable display-name fallback. Preserve the existing storage-specific filename/name reconciliation policy; the manifest must not become an independent editable title register.

All assets in the manifest must exist in the ZIP and match their identities and lengths. Every asset entry must appear in the manifest. Reject duplicate IDs, duplicate paths, conflicting descriptors, and unexpected undeclared payload entries under the version 2 layout. List assets in digest order when writing.

`requiredFeatures` describes package capabilities that cannot safely be ignored. Unsupported required features prevent editing or resaving; return a typed compatibility result. Unknown optional manifest fields may be ignored only if they have no preservation requirement. Extensions requiring round-trip preservation must declare that requirement through a supported capability. Never silently strip semantics and overwrite the source.

Initially avoid a general extension framework or arbitrary metadata bags. Future asset consumers should reuse asset references and typed consumer-specific metadata. Version the format when package interpretation actually changes.

Use stored ZIP entries for already compressed payloads, with optional compression for the manifest and Yjs snapshot. Compression policy is an implementation choice, not document semantics. ZIP timestamps, entry ordering, and compression output must not determine whether a document is dirty.

## Why a manifest does not need a CRDT

The manifest is a generated inventory, similar to an index built from a snapshot. It is not independently edited during collaboration.

To produce a package:

1. Capture immutable Yjs update bytes synchronously at a document generation boundary.
2. Inspect those bytes in an isolated Yjs document to collect required asset references.
3. Freeze the retained asset inventory and acquire pins for all included assets.
4. Resolve and verify descriptors and bytes.
5. Generate the manifest from that captured collection.
6. Write the ZIP and validate completeness before publication.
7. Release pins after the consuming operation finishes or is cancelled.

No `await` may allow capture to accidentally switch from the frozen Yjs state to the changing live tree. New edits during hashing, lookup, or ZIP assembly belong to a subsequent snapshot.

On download, validate the manifest and entries, persist verified assets, and merge Yjs state. After that merge, the live document can reference assets absent from the downloaded package because local or real-time edits are newer. That is expected. The next package is generated from the new merged state.

On a write conflict, merge document state and union retained asset inventories, verify asset identity, then regenerate the manifest. Do not merge manifest JSON fields as collaborative state. SHA-256 membership can use sets; descriptors and byte lookup still require maps/stores.

## Generic reference discovery

The package layer must not import image components or infer references by searching arbitrary strings for hash-like values.

Introduce a reference-collector boundary that inspects the captured Yjs representation and returns a set of asset IDs. Each supported content type declares how its persisted state references assets. This can be a registry of typed collectors for persisted node types, with a common helper for asset-reference fields.

Reference discovery must run without mounting React, downloading media, or starting a collaboration provider. It must use the actual persisted Lexical/Yjs representation; verify that representation before selecting traversal APIs. Add contract tests using real binding-generated snapshots rather than a hand-invented approximation of node serialization.

Unknown content that might contain references cannot be treated as safely reference-free for destructive cleanup. Retaining the package inventory permits lossless preservation of bytes even when a consumer is unavailable. Unsupported required editor semantics must block destructive resaving rather than flattening unknown nodes.

The asset subsystem stores generic blobs regardless of renderer support. Image decoding policy belongs to the image consumer. Adding an attachment consumer should require a node/feature and reference collector, not another Drive uploader, ZIP implementation, or IndexedDB database.

## Local working storage

Use a document-scoped asset repository keyed by document identity and asset ID. Document scoping simplifies deletion, isolation, copying, and retention. Deduplicate within a document initially; cross-document physical deduplication is optional future work requiring ownership tracking.

The repository persists blobs, descriptors, and ownership in IndexedDB. Asset availability is observable independently of Yjs updates. Durable pending-publication state belongs in local synchronization metadata so closing a tab does not discard the need to save.

Suggested boundaries:

```ts
type AssetId = string & { readonly __assetId: unique symbol }

interface AssetDescriptor {
  id: AssetId
  mediaType: string
  byteLength: number
}

interface AssetRepository {
  put(blob: Blob, signal?: AbortSignal): Promise<AssetDescriptor>
  get(id: AssetId, signal?: AbortSignal): Promise<Blob | undefined>
  list(): Promise<ReadonlyArray<AssetDescriptor>>
  subscribe(listener: (id: AssetId) => void): () => void
}

interface CapturedDocument {
  update: Uint8Array
  requiredAssets: ReadonlySet<AssetId>
  includedAssets: ReadonlyArray<AssetDescriptor>
  revision: string
}
```

These sketches express responsibilities; final APIs also need pinning, staged import/commit, flush, cancellation, and lifecycle handling. Do not implement a broad provider framework simply to match these sketches.

Blob writes complete before inserting references. Since Yjs persistence and blob storage may use separate transactions/databases, do not pretend they form one atomic transaction. The safe order is durable bytes, then the Yjs edit, then durable document flush. A crash between the first two leaves extra bytes, which is preferable to a locally created dangling reference. Existing references received from elsewhere may still be unresolved.

Local tabs share durable bytes through the repository. BroadcastChannel can announce asset availability after commit, keyed by document and hash; another tab reads IndexedDB rather than receiving duplicate blobs. Invalidate negative caches when availability changes. Cross-tab writes are idempotent and must respect existing document deletion/lifecycle locks.

Object URLs are view resources: create them when needed, revoke them when unused, and never persist them. Clear subscriptions, decoding work, and URLs when sessions close. Deleting a document removes its owned assets once active sessions are closed. Copying a document copies or acquires ownership of all included assets before reporting completion.

## Insertion and replacement lifecycle

For a generic blob insertion:

1. Apply feature-specific validation and optional processing under explicit resource limits.
2. Compute SHA-256 over the final bytes.
3. Persist bytes and the normalized descriptor; reuse an existing verified asset when available.
4. Recheck cancellation, editor lifetime, and edit permission.
5. Insert the reference and placement properties in a Yjs-backed editor transaction.
6. Flush local state and mark the storage session dirty.
7. Prioritize one complete package save through the existing queue.

If persistence fails, do not insert a knowingly unresolved local reference. Report the action failure once through Sonner. If insertion is cancelled after persistence, leave the unreferenced blob for conservative retention.

Replacement writes a new asset first and updates the reference afterward. A pending save captured with the old hash remains a valid older snapshot. It cannot acknowledge the replacement. Removing an image removes its placement; it does not delete bytes.

Undo/redo must restore references without a network requirement while retained local bytes are available. Infrastructure progress and asset arrival must not create editing undo entries.

## Missing-asset resolution

Track per-document, per-hash local availability separately from storage publication. Useful resolver states are `unresolved`, `checking-local`, `waiting-for-remote`, `fetching`, `available`, and `unavailable`. Cancellation, authentication, permissions, and corruption should retain typed causes rather than being collapsed into a permanent missing flag.

Resolution order in the initial implementation:

1. Check the local repository.
2. If linked to Drive, request coalesced document reconciliation.
3. Recheck the repository after a package import.
4. If the current remote package lacks the hash, retain the reference and schedule bounded retry while relevant.
5. Wake immediately on a publication notification, online/focus/auth recovery, explicit retry, or local asset arrival.

A package fetch resolves all requested hashes it contains. Never download a complete package independently for each image. Use one document-level in-flight reconciliation with a pending set of missing hashes. Metadata checks and negative results are associated with the checked ETag, not cached forever.

A missing hash in the current Drive revision does not prove permanent corruption: its publisher may still be uploading. Backoff and retry should avoid a tight loop. Establish a configurable foreground polling policy with jitter, a maximum retry rate, and pause/resume behavior for hidden/offline tabs. Keep the unavailable placeholder and allow explicit retry after automatic attempts are reduced. Exact timing is a tuning decision, not part of the format.

Render a stable placeholder preserving placement and alt text. Temporary waiting is not an operational error requiring a toast. Explicit failed user actions or persistent retrieval failures use deduplicated Sonner notifications; do not add red inline error prose. A disabled connection must not produce repeated notifications.

## Drive publication and acknowledgement

Drive remains one self-contained file. No sibling asset folder, separate permissions tree, new asset service, or remote reference URL is required.

Blob insertion bypasses the normal text-edit debounce by requesting the next save promptly. It does not bypass queue serialization, offline handling, authentication, or ETag reconciliation. If a save is in flight, mark an urgent follow-up; coalesce multiple insertions into that next snapshot. Do not cancel an almost completed publication merely because another asset was inserted.

Save algorithm:

1. Reconcile remote state when required by the existing concurrency policy.
2. Capture a frozen snapshot and retained inventory.
3. Resolve all required bytes. If incomplete, attempt Drive recovery before uploading.
4. If still incomplete, persist edits locally and leave cloud synchronization pending with a typed incomplete-assets cause. Do not overwrite Drive with an incomplete package.
5. Assemble and upload the complete binary package using the current ETag.
6. On success, acknowledge only the captured semantic revision, persist the returned validator, and emit an optional publication hint.
7. If the live state or retained inventory changed, keep dirty state and schedule another save.
8. On an ETag conflict, import and merge the latest package, union assets, recapture, and retry through bounded existing conflict handling.

An incomplete live snapshot can temporarily block cloud publication of unrelated new text. This is a deliberate first-version tradeoff to prevent publishing broken packages. Local editing and persistence continue. Saving a synthetic subset that excludes unresolved references would complicate acknowledgement and risk silently dropping content; it is outside scope.

Maintain an acknowledged snapshot independently from the changing live state. Persist dirty state across reloads. If the upload succeeds but the response is lost, reconcile the remote semantic revision before retrying; never assume failure means Drive did not commit.

Read media as binary and write multipart bodies with binary ZIP payloads. Remove JSON charset assumptions from the media part. Keep metadata JSON separate. Evaluate resumable uploads for package sizes and unreliable connections while preserving conditional-write semantics; do not assume the existing multipart implementation can simply be swapped without checking Drive v2 behavior.

Adopt a package MIME type appropriate to binary content, proposed `application/vnd.concept+zip`. Existing file listing and open filters must accept legacy `application/vnd.concept+json` and the new type. Verify MIME update behavior, shared-file access, and Drive picker/discovery paths before rollout. Retain `.concept` as the extension.

## Semantic revision tracking

Do not compare or hash ZIP bytes for dirty state. Equivalent packages may differ in ZIP timestamps, compression output, or metadata ordering.

Define a canonical revision input containing:

- Concept format version and document encoding;
- the portable normalized name;
- SHA-256 of the exact captured Yjs update bytes;
- the sorted included asset descriptors, with deterministic property ordering;
- required format capabilities.

Hash the canonical UTF-8 representation. Asset IDs already commit to asset bytes; do not reread every blob to compute dirty state after trusted ingestion. Verify untrusted bytes at import.

This is snapshot identity, not a claim that semantically equivalent Yjs histories always produce identical encodings. If Yjs update bytes differ, a conservative extra save is acceptable. Do not claim visual-content equivalence.

The asset inventory is included because retaining newly recovered bytes can change a package without changing visible document state. Runtime progress, local cache flags, ETags, ZIP entry times, and publication notifications are excluded.

## Optional real-time notifications

A transport-neutral event may contain a protocol version, storage kind, Drive file ID, an opaque committed validator/publication token, and the captured semantic revision. Exact wire naming is deferred to the collaboration protocol.

Send only after the complete package upload succeeds. Receive it as a hint that current Drive metadata may have changed. Validators are opaque: do not order ETags lexicographically or assume message arrival order identifies the newest revision.

Validate document membership and message shape, deduplicate tokens, rate-limit remote-triggered checks, and use the existing authorized Drive session. Never accept an arbitrary download URL from a peer. Notifications cannot grant Drive permissions.

The package does not contain its own post-upload receipt. Avoid a second content save merely to mark the first save complete. No `uploaded` node property, no publication-related undo entry, and no document-dirty loop.

Example race:

1. A persists asset H, inserts its reference, and starts a package upload.
2. B receives the reference through optional Yjs synchronization.
3. B checks the old Drive revision and retains a placeholder.
4. A completes the upload and announces publication.
5. B checks current Drive state, downloads the new package once, persists H, and updates its view.

If step 4 is lost, B's pending-asset reconciliation discovers the package. If no real-time connection exists, B receives the reference and bytes together during ordinary package reconciliation. If A disconnects before uploading, B cannot obtain bytes absent from every reachable durable source; preserve the reference and wait for A to reconnect. No protocol can reconstruct unavailable bytes from a hash.

RTC/WS asset transport is deliberately excluded initially. A future resolver adapter could request verified bytes through another authorized source without changing nodes, asset identity, package layout, or Drive completeness rules. That extension must address uploader fan-out, relay cost, chunking, flow control, cancellation, and resource limits separately.

## Retention and cleanup

Initial ordinary saves retain all verified assets owned by the document, including unreferenced assets imported from previous packages. Conflict merges union those inventories. This supports local undo, delayed updates, and stale collaborators without immediate byte deletion.

There is no general safe timeout for deleting an asset that an indefinitely offline peer might reference again. A CRDT merge can restore a reference without restoring separately deleted bytes. Yjs garbage collection does not solve external blob retention.

Consequences of conservative retention:

- Packages can grow after insertions and removals.
- Removing a node is not a promise that its bytes are erased from the package or Drive history.
- Packaging includes retained assets and pins them through upload/export.
- Quota failures must be reported without deleting the only copy of pending assets.

Automatic compaction, global deduplication, and permanent erasure are outside this change. A future explicit compaction/export mode needs a clear undo/history boundary and offline-peer policy. It cannot be added as an invisible mark-and-sweep over the current visible tree.

Local cache eviction is separate from package compaction. Evict only bytes known recoverable under the chosen offline policy, never dirty/unpublished assets or operation-pinned blobs. Do not promise complete offline availability merely because Yjs is cached.

## Offline, import, export, and recovery

An offline-capable document requires locally persisted Yjs state and every required asset. A stronger complete-package cache also retains the full included inventory. Define which promise the UI makes and verify it before setting `offlineAvailable`.

Downloading a complete `.concept` file and importing it supplies the state and assets needed to work without Drive. Actual offline app launch still depends on the future PWA app-shell/service-worker work; this format change alone does not implement a PWA.

Import uses staged storage: validate the ZIP, enforce limits, verify bytes, stage assets, then publish the new local document identity and merge its Yjs snapshot. Roll back or isolate failed imports so the library does not show a falsely completed document. Existing open documents must not be partially mutated by a malformed package.

Normal export captures and pins a complete snapshot. If required bytes are missing, attempt recovery when allowed, otherwise fail with a clear typed error and a single action toast. Never silently omit assets. A future explicit recovery export may preserve damaged state with a declared incomplete format, but must not masquerade as a valid complete version 2 package.

For a structurally readable but incomplete package, allow an explicit recovery path that preserves document references and verifies any available assets. Mark it incomplete, avoid automatic overwriting of the original, and block normal complete-save success until repaired. Invalid ZIP structure, invalid Yjs data, hostile paths, or resource-limit violations are hard failures, not recoverable missing-image states.

The ZIP parser must not eagerly reject a usable document merely because one payload is absent without exposing a typed recovery result. Conversely, normal validation must never call that package complete.

## Compatibility and rollout

Read legacy version 1 JSON and version 2 ZIP through one binary-input entry point that detects the representation and validates the claimed format. Version 1 normalizes into a snapshot with an empty asset inventory. New writes use version 2 after rollout, including documents without blobs, so there is one supported writer path.

Do not rewrite every Drive file in a background migration. Migrate on an authorized save/export. Older clients cannot be assumed to read ZIP packages; release coordination and a clear unsupported-version message are necessary. Do not downgrade a blob document to version 1.

Keep package format version, Yjs encoding version, persisted node schema versions, IndexedDB schema version, and optional collaboration protocol version distinct. They evolve for different reasons.

Storage APIs should deal with binary payloads and normalized snapshots. Editor components should deal with asset IDs and local resolver results. Only the package codec understands ZIP entry layout. Only the Drive adapter understands ETags, Drive MIME filters, and multipart/resumable transport.

## Resource limits and untrusted input

Define named, configurable limits before shipping: compressed package size, total expanded size, entry count, individual asset size, Yjs update size, manifest size, expansion ratio, image pixel count, and concurrent decoding/hash jobs. Numeric defaults require product/device decisions and measurements; they are not invented here.

Enforce bounds while reading/decompressing, before allocating claimed expanded sizes. Reject path traversal, absolute paths, backslashes or alternate separators, duplicate entries, encrypted entries, unsupported compression, malformed hashes, unexpected directories, unsafe integer lengths, and CRC/hash mismatches. Never extract arbitrary paths to disk.

Do not render arbitrary blobs as executable content. SVG/HTML support requires an explicit sanitization/rendering policy; generic blob storage support does not imply inline execution support. Image decoding must enforce resource limits independent of compressed byte length.

Use cancellation and operation generations to prevent late async completions from modifying closed/deleted sessions. Consider workers for compression, hashing, or decoding after measuring main-thread impact. Avoid introducing a large processing stack before it is needed.

## Failure handling matrix

| Condition                               | Required behavior                                                       |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Reference arrives before publication    | Preserve node, coalesce recovery, show placeholder                      |
| Publication hint is lost                | Foreground pending-asset checks and reconnect reconciliation recover    |
| Hint arrives before reference           | Reconcile safely; later reference finds cached bytes                    |
| Duplicate/out-of-order hint             | Deduplicate; check current authorized Drive state                       |
| Asset bytes arrive after node removal   | Persist under retention policy; do not recreate node                    |
| Permission revoked during upload        | Preserve local edits/assets; no publication success                     |
| Concurrent asset insertions             | Merge Yjs, union inventories, publish both assets                       |
| Client missing asset attempts text save | Recover first; otherwise keep cloud pending                             |
| Quota exceeded before insertion         | Fail insertion once; do not knowingly create reference                  |
| ZIP truncated or hash mismatched        | Reject normal import; preserve existing document                        |
| Upload committed but response lost      | Reconcile remote state before assuming publication failed               |
| Session closes mid-import/save          | Cancel safely; leave only staged or durably recoverable state           |
| Two tabs use the same asset             | Share durable store and availability events; no duplicate logical asset |
| Undo restores removed placement         | Resolve retained bytes without requiring a new upload                   |
| No Drive or real-time connection        | Local persistence/export still work with available bytes                |

## Verification plan

Test observable contracts and data-loss boundaries rather than private implementation details.

Package codec:

- Binary round-trip with multiple asset kinds, Unicode names, and an empty inventory.
- Byte-identical payload deduplication and deterministic canonical revision inputs.
- ZIP output differences do not change semantic revision.
- Missing payload, undeclared payload, duplicate path/ID, incorrect size/hash, unsupported version/capability, malformed Yjs, and decompression limits.
- Version 1 import and version 2 export without loss of document state.

Local persistence:

- Blob commit before insertion; crash/failure between stages leaves no knowingly dangling new local node.
- Concurrent puts, cancellation, database upgrade, document copy/delete, and cross-tab availability.
- Unpublished assets survive reload and cache cleanup.
- Offline availability does not become true with required assets missing.

Snapshot and synchronization:

- Edits during ZIP creation remain dirty after upload acknowledgement.
- Asset replacement during an earlier save cannot acknowledge the replacement.
- Concurrent insertions by two clients survive ETag retry with both payloads.
- Remote packages are validated before merging into live state.
- Early Drive check followed by publication resolves the asset.
- Lost publication event resolves through pending-asset reconciliation.
- Multiple missing references cause one coalesced fetch.
- Incomplete local state never overwrites a complete remote package.
- Lost upload response, read-only transitions, offline/auth recovery, and stopped-session races.
- Every core scenario runs with the notification adapter absent.

Integration acceptance:

1. Insert an asset, reload, and resolve it from local persistence.
2. Save to Drive, download the file, import into a clean offline-capable session, and resolve every required asset without Drive.
3. Concurrently insert different assets on two clients and verify a later package contains both.
4. Simulate a reference arriving before upload; verify placeholder then recovery with and without publication hints.
5. Remove and undo a reference; verify bytes remain available.
6. Run repository formatting, lint, typecheck, relevant tests, and build after implementation.

## Implementation sequence

1. Define normalized snapshot, asset ID/descriptor, typed package validation results, and generic reference-discovery contracts.
2. Implement document-scoped durable asset storage, ownership, staging, pinning, and availability subscriptions.
3. Implement bounded version 2 package codec and version 1 reader normalization.
4. Replace string-based revision/acknowledgement with captured semantic revisions.
5. Adapt local import/export/copy and document lifecycle integration.
6. Adapt Drive binary media, MIME compatibility, conflict asset unions, and urgent save scheduling.
7. Add missing-asset resolution, offline completeness checks, and transport-independent recovery triggers.
8. Expose the generic APIs for an image-node implementation; validate with real persisted node snapshots.
9. Add optional publication notification integration when a real-time provider exists. Do not make it a prerequisite for steps 1–8.

Each stage should preserve existing version 1 readability and avoid introducing a partial new writer that can lose blobs. Feature-gate the new writer until complete package persistence and recovery paths are ready together.

## Rollout and future-consumer decisions

Before enabling this release for existing Drive users, verify the JSON-to-ZIP MIME transition and shared-file access with live accounts, coordinate the reader upgrade with older clients, and communicate that older clients cannot open v2 ZIP files. Conditional resumable uploads remain deferred until Drive's final-write concurrency behavior is verified.

The future image-node implementation chooses accepted image types, image pixel and decoding budgets, processing behavior, and whether to preserve originals. The generic subsystem stores arbitrary immutable bytes and never executes active content.

Deferred deliberately: WS versus RTC, direct peer blob transfer, hosted asset storage, automatic compaction, persistent collaborative history, cross-document deduplication, and PWA app-shell implementation.

## References

- Existing implementation: `src/lib/documents/serialization.ts`, `concept-file.ts`, `revision.ts`, `sync.ts`, `drive/api.ts`, `transfer.ts`, `storage.ts`, `storages/local.ts`, and `local-provider.ts`.
- [Yjs document updates](https://docs.yjs.dev/api/document-updates): snapshot and incremental update primitives.
- [Google Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads): upload transport options; v2-specific integration must be verified during implementation.
- [WebRTC data-channel guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels): binary transfer support and buffering constraints relevant to a deferred peer-transfer option.
