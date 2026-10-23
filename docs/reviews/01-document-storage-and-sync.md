# Comprehensive Code Review & Issue Scan: `src/lib/documents/`

This review covers the document storage, synchronization, lifecycle, and formatting modules across `src/lib/documents/`. All findings are categorized by severity (**Critical**, **High**, **Medium**, **Low**) with root cause analysis, exact file/line references, and concrete proposed fixes.

---

## Findings Summary Matrix

| Severity     | ID             | Area / File                                                                                                                                                                                              | Summary                                                                        |
| :----------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| **Critical** | `SYNC-01`      | [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L48-L86)                                                                                                      | Multi-tab infinite save storm & Google Drive API ping-pong loop                |
| **High**     | `SYNC-02`      | [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L88-L96)                                                                                                      | 30-second edit blackout & potential data loss on concurrent typing during save |
| **High**     | `STOR-01`      | [storages/local-content.ts](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L99-L121)                                                                                           | Quadratic/unbounded IndexedDB growth from redundant update writes              |
| **High**     | `STOR-02`      | [storages/local-content.ts](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L61-L83)                                                                                            | Leaked IndexedDB connections & blocked database deletion on early close        |
| **High**     | `LIFECYCLE-01` | [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L147-L167)                                                                                                    | TDZ crash (`ReferenceError`) & permanent background sync lockup                |
| **High**     | `PERF-01`      | [concept-file.ts](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L48-L52), [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L67-L69)           | Massive CPU/heap GC stall on Base64 decoding (`Uint8Array.from(atob)`)         |
| **High**     | `DRIVE-01`     | [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L108)                                                                                                         | Spurious multipart PATCH and 403 crashes for view-only users on document open  |
| **Medium**   | `LEAK-01`      | [storages/local-content.ts](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L51-L86)                                                                                            | Memory leak of sessions and `Doc` instances when `whenSynced` rejects          |
| **Medium**   | `SYNC-03`      | [local-provider.ts](file:///home/maddock/concept/src/lib/documents/local-provider.ts#L79-L87)                                                                                                            | Message echo amplification across 3+ tabs on `response` messages               |
| **Medium**   | `VAL-01`       | [validate-content.ts](file:///home/maddock/concept/src/lib/documents/validate-content.ts#L27)                                                                                                            | Document validation rejects valid documents with checklist elements            |
| **Medium**   | `UI-01`        | [concept-file.ts](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L99-L107)                                                                                                               | Download link `.click()` without DOM attachment fails in Firefox/iframes       |
| **Medium**   | `SSR-01`       | [theme-transition.ts](file:///home/maddock/concept/src/lib/documents/theme-transition.ts#L22-L35), [workspace-storage.ts](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L105-L106) | Unchecked `document`, `window`, and `navigator` globals causing SSR crashes    |
| **Low**      | `META-01`      | [concept-file.ts](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L76-L84)                                                                                                                | Stale `updatedAt` overwrite in `importConcept` drops recent docs in list       |
| **Low**      | `CHAN-01`      | [library-channel.ts](file:///home/maddock/concept/src/lib/documents/library-channel.ts#L10-L24)                                                                                                          | Unhandled listener exceptions halt broadcast delivery                          |

---

## Critical Findings

### `SYNC-01`: Multi-tab Infinite Save Storm & Google Drive Ping-Pong Loop

- **Status**: FIXED (`6f79563`)
- **Validation**: Confirmed that both live peer broadcasts via `LocalProvider` and post-save/post-import `publishDocumentUpdate` calls applied updates with origins different from the isolated `remoteOrigin` closure object in `workspaceDocumentStorage.open`, causing every open tab to mark `dirty = true` and schedule its own Drive upload. Added shared `remoteDocumentOrigin` and `synced` channel metadata across `document-channel.ts`, `storages/local-content.ts`, `local-provider.ts`, and `workspace-storage.ts`, and ignored `LocalProvider` peer origins in `changed()`. Added multi-tab regression test `does not trigger a ping-pong save storm across multiple open tabs` in `src/lib/documents/workspace-storage.test.ts`.
- **Locations**:
  - [`workspace-storage.ts` (L48–L86)](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L48-L86)
  - [`storages/local-content.ts` (L89–L98)](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L89-L98)
  - [`local-provider.ts` (L83–L86)](file:///home/maddock/concept/src/lib/documents/local-provider.ts#L83-L86)
- **Impact**: When two tabs have the same Drive document open, an edit in either tab triggers an infinite loop of repeated Google Drive saves, exhausting API quotas, creating thousands of unnecessary revisions, and causing extreme network/battery drain.
- **Root Cause**:
  1. Tab A edits the document and triggers `sync()`.
  2. Tab A finishes `saveDrive()` and calls `publishDocumentUpdate(id, update)`.
  3. `publishDocumentUpdate` posts `{ type: 'update', update }` to `BroadcastChannel`.
  4. Tab B's [`LocalProvider.onMessage`](file:///home/maddock/concept/src/lib/documents/local-provider.ts#L83-L86) receives the broadcast update and applies it: `applyUpdate(this.doc, data.update, this)`.
  5. In Tab B's `workspaceDocumentStorage.open`, `doc.on('update', changed)` fires:
     ```typescript
     const remoteOrigin = {}
     function changed(_update: Uint8Array, origin: unknown) {
       if (origin !== remoteOrigin) schedule()
     }
     ```
     Because `remoteOrigin` is an isolated object in Tab A's closure, the origin in Tab B is Tab B's `LocalProvider`, so `origin !== remoteOrigin` evaluates to `true`.
  6. Tab B marks `dirty = true` and schedules its own Drive upload.
  7. 1 second later, Tab B uploads to Drive and broadcasts its update back to Tab A.
  8. Tab A marks `dirty = true` and re-schedules another save.
- **Proposed Fix**:
  Share a canonical broadcast origin across modules, or pass origin metadata through the channel so tabs ignore updates that originated from remote sync completion. Additionally, only mark `dirty = true` when mutations originate locally from the user/Lexical editor, not from peer broadcast syncs.

---

## High Severity Findings

### `SYNC-02`: 30-Second Edit Blackout & Data Loss on Concurrent Edits During Save

- **Status**: FIXED (`87ce670`)
- **Validation**: Confirmed that `sync()` unconditionally reset the timer to `30_000ms` in `finally` whenever `hasChanges()` was true, overriding the 1-second debounce scheduled by concurrent user edits while `saveDrive` was in flight. Scoped the `30_000ms` retry backoff to the `catch` branch and preserved the `1000ms` debounce on successful completion. Added regression test `saves concurrent edits after 1 second instead of a 30-second error backoff` in `src/lib/documents/workspace-storage.test.ts`.
- **Location**: [`workspace-storage.ts` (L52–L96)](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L52-L96)
- **Impact**: Changes made by the user while a Drive save is in flight are delayed from saving for **30 seconds** instead of the normal 1 second. If the user closes the window or navigates away in that window, remote synchronization is lost.
- **Root Cause**:
  In `sync()`:
  ```typescript
  async function sync() {
    if (isClosed() || running || !hasChanges()) return
    running = true
    dirty = false
    try {
      ...
      const remote = await saveDrive(...)
    } catch (cause) {
      dirty = true
    } finally {
      running = false
      if (hasChanges() && !isClosed()) {
        clearTimeout(timer)
        timer = setTimeout(() => void sync(), 30_000) // <-- Resets 1s timer to 30s!
      }
    }
  }
  ```
  If the user types while `saveDrive` is in-flight, `changed()` sets `dirty = true` and sets a 1000ms timer. When `saveDrive` finishes, `finally` unconditionally resets that timer to `30_000ms`, treating active user changes as an error retry backoff.
- **Proposed Fix**:
  Only use the 30-second backoff in the `catch` branch (on failure). On successful sync with remaining dirty changes, schedule with the normal 1-second debounce:
  ```typescript
  let retryDelay = 1000
  ...
  } catch (cause) {
    dirty = true
    retryDelay = 30_000
    ...
  } finally {
    running = false
    if (hasChanges() && !isClosed()) {
      clearTimeout(timer)
      timer = setTimeout(() => void sync(), retryDelay)
    }
  }
  ```

---

### `STOR-01`: Quadratic / Unbounded IndexedDB Growth in `persistDocumentUpdate`

- **Status**: FIXED AND REGRESSION VALIDATED (integration follow-up in this commit)
- **Validation**: Confirmed and fixed integration follow-up: compaction now reads every current update, merges, clears, and writes one canonical snapshot within the same readwrite transaction. This preserves writes from tabs without the lifecycle lock. A deterministic regression queues a separate connection append after initial load; the original implementation loses that peer edit, while the fix preserves imported and peer edits after reopen and leaves one record. Transaction aborts reject and temporary persistence is closed.
- **Location**: [`storages/local-content.ts` (L99–L121)](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L99-L121)
- **Impact**: Document databases in IndexedDB continuously grow in size, duplicating full state snapshots on every single save or import, degrading loading performance and storage consumption.
- **Root Cause**:
  In `persistDocumentUpdate`:
  ```typescript
  await persistence.whenSynced
  applyUpdate(doc, update) // 1. y-indexeddb listens to doc updates and automatically writes to 'updates'
  const merged = encodeStateAsUpdate(doc)
  const db = persistence.db
  ...
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('updates', 'readwrite')
    transaction.objectStore('updates').add(merged) // 2. Manually writes the full state merged update again!
    ...
  })
  ```
  `applyUpdate(doc, update)` causes `IndexeddbPersistence._storeUpdate` to write `update`. Lines 107–114 manually write `merged` (the entire document history). Because old records in `'updates'` are never trimmed or cleared, every call appends both the incremental update and the full snapshot.
- **Proposed Fix**:
  Do not manually `.add(merged)` to `'updates'`. If manual replacement is needed, clear old updates first via `store.clear()`, or let `IndexeddbPersistence` manage its own storage lifecycle.

---

### `STOR-02`: Leaked IndexedDB Connections & Blocked Deletion on Early Close

- **Status**: FIXED AND REGRESSION VALIDATED (integration follow-up in this commit)
- **Validation**: Confirmed and fixed integration follow-up: destroying an initialized but unsynced y-indexeddb instance leaves its whenSynced unresolved. Close now waits for its initial read before destroying it, while a queued open without persistence closes immediately to avoid waiting behind deletion's lifecycle lock. Regression coverage closes after persistence construction and before sync, verifies deletion and reopen, and retains the existing stale-open/deletion regression.
- **Location**: [`storages/local-content.ts` (L61–L83)](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L61-L83)
- **Impact**: Fast tab switching, React StrictMode double-mounting, or immediate deletions leave orphaned IndexedDB database handles open. When `delete()` is called later, `indexedDB.deleteDatabase` is blocked, throwing `"Close other tabs using this document and try deleting again."`.
- **Root Cause**:
  In `openDocument`:
  ```typescript
  destroy() {
    closed = true
    closing ??= (
      persistence
        ? whenSynced.catch(() => {}).then(() => persistence?.destroy())
        : Promise.resolve()
    )
  }
  ```
  If `session.destroy()` is called while `whenSynced` is still executing (e.g. while awaiting `withDocumentLock` or dynamic import):
  1. `persistence` is `undefined`.
  2. `closing` is assigned `Promise.resolve()`.
  3. Later, `whenSynced` proceeds to instantiate `persistence = new IndexeddbPersistence(...)`.
  4. Because `closing` already settled, `persistence.destroy()` is never called, leaking the connection. Subsequent `deleteDatabase` requests are blocked.
  5. Furthermore, `whenSynced` rejects with `Error('Document closed')`, which goes unhandled since `destroy()` did not chain to `whenSynced`.
- **Proposed Fix**:
  Track the initialization promise and always destroy `persistence` when it becomes available:
  ```typescript
  destroy() {
    closed = true
    closing ??= whenSynced
      .catch(() => {})
      .then(() => persistence?.destroy())
      .finally(() => {
        activeDocuments.get(id)?.delete(session)
        if (!activeDocuments.get(id)?.size) activeDocuments.delete(id)
        sessions.delete(session)
        if (sessions.size === 0 && activeSessions.get(id) === sessions)
          activeSessions.delete(id)
      })
    return closing
  }
  ```

---

### `LIFECYCLE-01`: Temporal Dead Zone Crash & Permanent Lockup in `ensureBackgroundSync`

- **Status**: FIXED (`ee7f8a8`)
- **Validation**: Confirmed that synchronous invocation of `listener(status)` inside `session.subscribeStatus` with initial synced state caused `cleanup()` to reference `stop` and `unsubscribe` before declaration in TDZ, throwing `ReferenceError` and locking background sync. Fixed by managing disposables via array and tracking cleanup state in an object. Added validation test `handles synchronous synced status or early rejection during background sync without TDZ crash (LIFECYCLE-01)` in `src/lib/documents/workspace-storage.test.ts`.
- **Location**: [`workspace-storage.ts` (L147–L167)](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L147-L167)
- **Impact**: An immediate sync or early error triggers a `ReferenceError: Cannot access 'stop'/'unsubscribe' before initialization`. The crash skips session destruction and leaves `openSessions.get(id)` non-zero, permanently disabling background sync for that document.
- **Root Cause**:
  ```typescript
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    stop?.()
    unsubscribe() // <-- TDZ if called synchronously!
    void session.destroy().finally(() => doc.destroy())
  }
  const stop = session.subscribeStatus?.((status) => {
    if (status.state === 'synced') cleanup() // <-- Called synchronously inside subscribeStatus!
  })
  const unsubscribe = localDocumentStorage.subscribe(...)
  void session.whenSynced.catch(cleanup)
  ```
  `session.subscribeStatus` synchronously calls `listener(status)`. If `status.state === 'synced'`, `cleanup()` executes before `stop` or `unsubscribe` have finished initializing.
- **Proposed Fix**:
  Declare cleanup callbacks with `let` before invoking methods:
  ```typescript
  let stop: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    stop?.()
    unsubscribe?.()
    void session.destroy().finally(() => doc.destroy())
  }
  ```

---

### `PERF-01`: Massive CPU & GC Stall in Base64 Byte Decoding

- **Status**: FIXED (`aa83b89`)
- **Validation**: Confirmed `Uint8Array.from(atob(str), cb)` allocated millions of single-character strings and JS callbacks for large files, and `importConcept` redundantly decoded the same file multiple times. Implemented indexed loop `decodeUpdate`, reused decoded buffer in `importConcept`, and adopted `decodeUpdate` in `workspace-storage.ts` and `drive/server.ts`. Added validation test `decodes Base64 updates efficiently into Uint8Array` in `src/lib/documents/concept-file.test.ts`.
- **Locations**:
  - [`concept-file.ts` (L48–L52)](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L48-L52)
  - [`workspace-storage.ts` (L67–L69)](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L67-L69)
  - [`drive/server.ts` (L196–L199)](file:///home/maddock/concept/src/lib/documents/drive/server.ts#L196-L199)
- **Impact**: Importing, saving, or parsing documents > 5MB blocks the UI thread for seconds or crashes Cloudflare Workers due to CPU time limits (Error 1102). In `importConcept`, this decode runs 3 times for the same file.
- **Root Cause**:
  ```typescript
  Uint8Array.from(atob(file.update), (character) => character.charCodeAt(0))
  ```
  `Uint8Array.from(str, fn)` treats strings as character iterables. For an $N$-byte file, it allocates $N$ single-character strings on the heap and invokes a JS callback $N$ million times.
- **Proposed Fix**:
  Use a single indexed loop without intermediate string allocations:
  ```typescript
  export function decodeUpdate(updateBase64: string): Uint8Array {
    const binary = atob(updateBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  ```

---

### `DRIVE-01`: Spurious Multipart PATCH and 403 Crashes for View-Only Users

- **Status**: FIXED (server semantic no-op detection; integration follow-up).
- **Validation**: Confirmed that `saveDriveFile` unconditionally PATCHed existing files even when merging cached state added no changes. Rejected `7137ab4`: matching names do not establish that offline content is saved, so skipping synchronization on reopen can strand unsaved edits. `workspace-storage.ts` reopen and unsaved peer scheduling remain intact.
- **Fix**: After the authorized, coordinated remote read and identity/name resolution, compare canonical `encodeStateAsUpdate` snapshots before and after applying local state. Full snapshots include delete sets (state vectors alone miss deletions). Return the remote document/file when content and resolved name are unchanged. New files, local content changes, deletions and renames still upload; remote merges, stable IDs, ETag/version checks and offline cache opening remain intact.
- **Regression coverage**: `drive/server.test.ts` covers unchanged read-only files (GET succeeds; any mutation would return 403), remote-only content/name changes returned without PATCH, equal-state-vector deletions and name changes still PATCHing with If-Match, creation and concurrent merge behavior. `workspace-storage.test.ts` verifies unsaved cached content uploads after closing and reopening despite matching names.
- **Checks**: 38 tests passed across `drive/server.test.ts` and `workspace-storage.test.ts`; scoped ESLint and full `tsc --noEmit` passed.
- **Risk**: Read-only users with actual unsaved changes still receive authorization errors, preserving their browser copy. GETs and existing version checks remain necessary; equality is deliberately based on complete CRDT state rather than visible editor text.

---

## Medium Severity Findings

### `LEAK-01`: Memory Leak of Sessions and `Doc` on Failed Open

- **Status**: FIXED AND REGRESSION VALIDATED (integration follow-up in this commit)
- **Validation**: Confirmed and fixed integration follow-up: failed initialization now awaits persistence destruction before propagating rejection, and removes active session/document entries. A forced whenSynced rejection after a real database opens verifies deletion succeeds and later broadcasts do not mutate the failed document. Import rejection also verifies temporary Doc destruction and connection cleanup; nested finally guarantees Doc cleanup even if persistence destruction rejects.
- **Location**: [`storages/local-content.ts` (L51–L54, L80–L86)](file:///home/maddock/concept/src/lib/documents/storages/local-content.ts#L51-L86)
- **Impact**: If `whenSynced` rejects (e.g. document not found or storage error), the session and `Doc` remain permanently registered in `activeSessions` and `activeDocuments`.
- **Root Cause**: `sessions.add(session)` and `documents.set(session, doc)` occur synchronously before `whenSynced` resolves, and there is no `.catch()` handler removing them upon failure.
- **Proposed Fix**: Attach a `.catch()` cleanup handler to `whenSynced` inside `openDocument`:
  ```typescript
  void whenSynced.catch(() => {
    sessions.delete(session)
    activeDocuments.get(id)?.delete(session)
  })
  ```

---

### `SYNC-03`: Broadcast Message Echo Amplification across 3+ Tabs

- **Status**: FIXED (`6b7e2c4`)
- **Validation**: Confirmed `BroadcastChannel` messages lacked client identity metadata, causing peers to treat third-party responses as their own and broadcast empty updates. Added `clientId` and `targetId` to `DocumentChannelMessage`, ignored responses directed to other clients or own echoes, and suppressed empty updates (`diff.byteLength <= 2`). Added validation test `does not amplify messages or trigger echo loops when 3 or more tabs are connected (SYNC-03)` in `src/lib/documents/local-provider.test.ts`.
- **Location**: [`local-provider.ts` (L79–L87)](file:///home/maddock/concept/src/lib/documents/local-provider.ts#L79-L87)
- **Impact**: Opening 3 or more tabs creates an exponential storm of `update` messages in response to every `response` message.
- **Root Cause**:
  `BroadcastChannel` is peer-to-peer. When Tab C receives Tab B's `response` to Tab A's `request`, Tab C acts as if it requested it and broadcasts an `update` back. Neither `request` nor `response` messages specify sender/recipient client IDs, and `update` messages are sent even when `encodeStateAsUpdate` has zero operations.
- **Proposed Fix**:
  Include `sender` and `target` client IDs in channel messages so only the requester processes the `response`. Check if `update.byteLength > 2` before calling `this.send({ type: 'update', update })`.

---

### `VAL-01`: Validation Rejection of Valid Documents with Checklists

- **Status**: CONFIRMED NOT AN ISSUE (`72f064a`)
- **Validation**: Triaged against `@lexical/list` and Lexical architecture. Confirmed that checklists in Lexical are represented via `ListNode` with `listType === "check"` and `ListItemNode` with `checked: boolean`, rather than a separate node class. Both `ListNode` and `ListItemNode` are already registered in `validate-content.ts` and `import/index.ts`. Validated with regression test `validates and round-trips markdown task lists with checkboxes (VAL-01 triage)` in `src/lib/documents/import/import.test.ts`.
- **Location**: [`validate-content.ts` (L27)](file:///home/maddock/concept/src/lib/documents/validate-content.ts#L27)
- **Impact**: Any valid `.concept` document created with checklists or imported markdown containing task lists can fail `validateDocumentContent`, preventing import.
- **Root Cause**:
  `validateDocumentContent` initializes Lexical with only `[HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode]`, while the actual editor in `src/components/nova/editor.ts` supports checklists and extended list structures. Any document serialized with checklist tags fails validation.
- **Proposed Fix**: Align registered node definitions between `editor.ts`, `validate-content.ts`, and `import/index.ts`.

---

### `UI-01`: Download Anchor Not Attached to DOM in Firefox

- **Status**: FIXED (`dfaa73d`)
- **Validation**: Confirmed `downloadConcept` in `concept-file.ts` invoked `link.click()` on an anchor element not appended to the DOM, which fails in Firefox and restricted iframe contexts. Fixed by attaching `link` to `document.body` before `click()` and removing it immediately afterwards. Added validation test `attaches download link to DOM, clicks it, and cleans it up` in `src/lib/documents/concept-file.test.ts`.
- **Location**: [`concept-file.ts` (L99–L107)](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L99-L107)
- **Impact**: Clicking "Download Concept File" silently fails to initiate a download in Firefox and certain embedded browser contexts.
- **Root Cause**: `link.click()` is called on an anchor element that has not been appended to `document.body`.
- **Proposed Fix**:
  ```typescript
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  ```

---

### `SSR-01`: Unchecked `document`, `window`, and `navigator` Globals

- **Status**: FIXED (`950deb3`)
- **Validation**: Confirmed unguarded accesses to `document`, `window`, and `navigator` in `theme-transition.ts` and `workspace-storage.ts` cause SSR crashes (`ReferenceError: document/window/navigator is not defined`). Added `typeof` guards for `document`, `window`, and `navigator` with graceful fallbacks. Added validation test `does not throw in SSR environments when document is undefined (SSR-01)` in `src/lib/documents/theme-transition.test.ts`.
- **Locations**:
  - [`theme-transition.ts` (L22–L35)](file:///home/maddock/concept/src/lib/documents/theme-transition.ts#L22-L35)
  - [`workspace-storage.ts` (L49, L105–L106)](file:///home/maddock/concept/src/lib/documents/workspace-storage.ts#L49)
- **Impact**: Server-side rendering (SSR) or tests without full DOM mocks throw `ReferenceError: document is not defined` or `navigator is not defined`.
- **Root Cause**: Direct access to `document.documentElement`, `innerWidth`, `performance.now()`, and `navigator.onLine` without `typeof window !== 'undefined'` guards.
- **Proposed Fix**: Wrap browser API access with `typeof window !== 'undefined'` and `typeof navigator !== 'undefined'`.

---

## Low Severity Findings

### `META-01`: Stale `updatedAt` Overwrite in `importConcept`

- **Status**: FIXED (`b545bcb`)
- **Validation**: Confirmed `importConcept` overwrote `current.updatedAt` with `target.updatedAt` via `...target`, which downgraded timestamps for newly opened/imported documents if `target.updatedAt` was stale. Fixed by preserving `Math.max(current.updatedAt, target.updatedAt, Date.now())`. Added validation test `preserves the latest updatedAt timestamp when importing an existing target document` in `src/lib/documents/concept-file.test.ts`.
- **Location**: [`concept-file.ts` (L76–L84)](file:///home/maddock/concept/src/lib/documents/concept-file.ts#L76-L84)
- **Impact**: Importing or reopening an existing Drive document replaces the document's local `updatedAt` with `target.updatedAt`, which may be an old timestamp. This causes newly imported documents to drop down in `localDocumentStorage.list()`.
- **Proposed Fix**: Explicitly preserve or update timestamp: `updatedAt: Math.max(current.updatedAt, Date.now())`.

---

### `CHAN-01`: Unhandled Listener Exceptions in `library-channel.ts`

- **Status**: FIXED (`d6dae50`)
- **Validation**: Confirmed unhandled exceptions thrown by a library subscriber aborted iteration over remaining listeners and prevented `BroadcastChannel.postMessage` from dispatching. Fixed by wrapping listener callbacks in `try...catch` and iterating over a snapshot of the listener set. Added validation tests in `src/lib/documents/library-channel.test.ts`.
- **Location**: [`library-channel.ts` (L10, L23)](file:///home/maddock/concept/src/lib/documents/library-channel.ts#L10)
- **Impact**: If one listener registered to `subscribeToLibrary` throws, remaining listeners are not invoked and `BroadcastChannel.postMessage` is aborted.
- **Proposed Fix**:
  Iterate over a copy and wrap listener calls in `try...catch`:
  ```typescript
  for (const listener of [...listeners]) {
    try {
      listener(change)
    } catch (error) {
      console.error('Library listener error:', error)
    }
  }
  ```

## Storage integration follow-ups

All assigned storage commits except 7137ab4 were integrated. DRIVE-01 skip-on-open was rejected because matching names do not prove cached content is saved. Follow-up 205096d now avoids redundant server PATCH while retaining reopening synchronization; canonical Yjs comparison includes delete sets. STOR-01 follow-up 5dcaa16 merges current persisted updates within the same readwrite transaction before replacing the update log. Early-destroy and failed-open cleanup are also verified. Both storage integration follow-ups are resolved.
