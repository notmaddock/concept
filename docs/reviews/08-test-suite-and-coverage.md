# Comprehensive Test Suite & Infrastructure Audit Report

An in-depth audit of the test suite and testing infrastructure was conducted across all 39 test files (`src/**/*.test.ts*`), mock modules (`src/test/broadcast-channel.ts`, `src/test/cloudflare-workers.ts`), and test configuration (`vitest.config.ts`).

---

## 1. Executive Summary & Test Execution Status

- **Total Test Files**: 39
- **Passing / Failing Files**: 36 passed, **3 failed** (exit code 1)
- **Total Tests**: 238 (182 passed, 52 queued/processed, **4 failed**)
- **Duration**: ~20.70s (with JSDOM environment creation taking 88.77s total, ~46% of tracked time; `PageSetupDialog.test.tsx` alone taking 17.55s)
- **Primary Root Causes**:
  1. Broken module imports causing immediate test execution failures.
  2. Leaking module-level singletons and unhandled mock cleanup causing cross-test pollution.
  3. Heavy reliance on real timers (`setTimeout`) causing flakiness and race conditions.
  4. Complete test blind spots over core architectural pillars (the `DocumentWorkspace` orchestrator, `Nova` editor integration & plugins, and document transfer across cloud storage).

---

## 2. Findings Categorized by Severity

### Critical Severity

#### 1. Broken Storage Imports Causing Immediate Test Failures (4 Tests Failing)

- **Implementation status (2026-10-23)**: RESOLVED IN BASE: all three tests already import storages/local after 40832e0; retained unchanged.

- **Exact File References**:
  - [src/components/documents/DocumentDetails.test.tsx:16, 128](file:///home/maddock/concept/src/components/documents/DocumentDetails.test.tsx#L16)
  - [src/components/documents/DocumentEditor.test.tsx:15, 88](file:///home/maddock/concept/src/components/documents/DocumentEditor.test.tsx#L15)
  - [src/components/documents/NewDocument.test.tsx:7, 35](file:///home/maddock/concept/src/components/documents/NewDocument.test.tsx#L7)
- **Description**: All three test files attempt to import `localDocumentStorage` from `#/lib/documents/storage`:
  ```ts
  import { localDocumentStorage } from '#/lib/documents/storage'
  ```
  However, [src/lib/documents/storage.ts](file:///home/maddock/concept/src/lib/documents/storage.ts) only exports TypeScript interfaces and types (`DocumentInfo`, `DocumentStorage`, `DocumentPersistence`, etc.). The actual singleton is implemented and exported from [src/lib/documents/storages/local.ts:13](file:///home/maddock/concept/src/lib/documents/storages/local.ts#L13).
- **Impact**: `localDocumentStorage` is `undefined` at runtime. Running `pnpm test` crashes with:
  - `Error: The vi.spyOn() function could not find an object to spy upon. The first argument must be defined` ([DocumentDetails.test.tsx:128](file:///home/maddock/concept/src/components/documents/DocumentDetails.test.tsx#L128))
  - `TypeError: Cannot read properties of undefined (reading 'create')` ([DocumentEditor.test.tsx:88](file:///home/maddock/concept/src/components/documents/DocumentEditor.test.tsx#L88))
  - `TypeError: Cannot read properties of undefined (reading 'list')` ([NewDocument.test.tsx:35](file:///home/maddock/concept/src/components/documents/NewDocument.test.tsx#L35))
- **Recommendation**: Correct the import in all three test files to:
  ```ts
  import { localDocumentStorage } from '#/lib/documents/storages/local'
  ```

#### 2. Persistent Module Singleton Mutation Causing Cross-Test Pollution

- **Implementation status (2026-10-23)**: FIXED: reversible spyOn mocks replace Object.assign, with restored singleton methods (4af6575). Vitest isolates files by default, so the original cross-file claim was overstated; mutation within a test file was real.

- **Exact File Reference**: [src/hooks/use-documents.test.tsx:197](file:///home/maddock/concept/src/hooks/use-documents.test.tsx#L197)
- **Description**: The test mutates an imported module-level singleton using `Object.assign`:
  ```ts
  Object.assign(workspaceDocumentStorage, storage)
  ```
  `afterEach` in this file only unmounts the React root and removes the container; it **never restores** the original methods of `workspaceDocumentStorage`.
- **Impact**: The exported `workspaceDocumentStorage` instance remains mutated across any subsequent test executed within the same worker thread. Any test importing `workspaceDocumentStorage` will interact with stale mocks rather than the real implementation.
- **Recommendation**: Never mutate imported singleton objects directly. Use `vi.spyOn(workspaceDocumentStorage, 'rename')` or instantiate test-specific storage fixtures. Ensure `vi.restoreAllMocks()` is called in `afterEach`.

#### 3. Complete Test Absence on Core Application Orchestrator (`DocumentWorkspace`)

- **Implementation outcome (2026-10-23): FIXED — Confirmed the orchestrator had no direct test file before the preserved commits. `src/components/documents/DocumentWorkspace.test.tsx` now exercises loading, index/empty selection, unavailable cached document, create action, active-document switching, title/theme cleanup, document-scoped sync status, library/action errors, copy/import/details/share/page-setup workflows and theme forwarding. Hook, editor and dialog boundaries are mocked; this validates workspace wiring rather than real cloud/auth integration.**

- **Exact File Reference**: [src/components/documents/DocumentWorkspace.tsx](file:///home/maddock/concept/src/components/documents/DocumentWorkspace.tsx)
- **Description**: `DocumentWorkspace` is the top-level orchestrator of Concept. It manages:
  - Document lifecycle (create, load, rename, delete) and library error states.
  - Active document switching and dynamic lazy-loading of `DocumentEditor`.
  - Document theme state transitions and real-time color syncing.
  - Storage transfer, cloud copy, page setup, and share dialogs.
  - Sidebar synchronization and library navigation.
- **Impact**: It has **0% test coverage** (no test file exists). High-level regressions in routing, document switching, or error handling will break production unnoticed.
- **Recommendation**: Implement `src/components/documents/DocumentWorkspace.test.tsx` testing initial document load, empty state rendering, switching between documents, error alert displays, and modal trigger workflows.

---

### High Severity

#### 4. Complete Test Absence on Cloud Storage Transfer Engine

- **Implementation outcome (2026-10-23): FIXED — Confirmed `transfer.ts` lacked direct coverage. `src/lib/documents/transfer.test.ts` uses real fake-IndexedDB/Yjs persistence and Concept serialization with only the Drive function boundary mocked. It verifies local/Drive listing separation, Drive read/open import with content round-trip, missing backing rejection, local read/copy, local save without backing, Drive save/cache metadata and authorization error propagation for list/read/save.**

- **Exact File Reference**: [src/lib/documents/transfer.ts](file:///home/maddock/concept/src/lib/documents/transfer.ts)
- **Description**: `transfer.ts` is the foundational data bridge that exports, imports, and migrates documents between the local IndexedDB database and Google Drive (`documentSources`, `documentSaveProviders`, `copyToStorage`, `readDocumentForTransfer`).
- **Impact**: It has **0% test coverage**. Regressions in account selection, concept file validation during transfer, or Google Drive read/write bridges can corrupt document persistence or silently lose user changes when transferring to or from the cloud.
- **Recommendation**: Create `src/lib/documents/transfer.test.ts` to test:
  1. Listing documents from Drive vs. local storage.
  2. Reading Drive documents into the `SelectedDocument` representation.
  3. Saving local documents to Drive and vice versa.
  4. Proper error escalation when account authorization expires.

#### 5. Untested Editor Shell & Plugin Integration (`Nova` Mocking Blind Spot)

- **Implementation outcome (2026-10-23): FIXED — Confirmed the direct Nova/toolbar/drag/slash coverage gaps. Added `Nova.test.tsx` (real standalone/collaborative extension initialization and plugin wiring), `FloatingTextFormatToolbar.test.tsx` (format command dispatch, expanded controls and color reset on actual Lexical selection), `DragPlugin.test.tsx` (handle/target refs and containment), and `SlashMenuPlugin.test.tsx` (real trigger matching, IME suppression, filtering, transactional block conversion/query cleanup, portal options, keyboard highlight, click selection and empty state). Parent IME guard is preserved; test callbacks now pass the editor and execute selection within a Lexical update. Lexical typeahead/draggable transport is mocked, so browser caret geometry, full keyboard dismissal and physical drag/drop remain outside these focused tests.**

- **Exact File References**:
  - [src/components/nova/Nova.tsx](file:///home/maddock/concept/src/components/nova/Nova.tsx)
  - [src/components/documents/DocumentEditor.test.tsx:22-38](file:///home/maddock/concept/src/components/documents/DocumentEditor.test.tsx#L22-L38)
  - [src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.test.tsx:12-14](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.test.tsx#L12-L14)
  - [src/components/nova/plugins/DragPlugin/DragPlugin.tsx](file:///home/maddock/concept/src/components/nova/plugins/DragPlugin/DragPlugin.tsx)
  - [src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx)
- **Description**:
  1. `DocumentEditor.test.tsx` completely mocks out `<Nova />` with a bare `<LexicalComposer />`, meaning `Nova.tsx` itself has 0% direct or indirect coverage.
  2. `FloatingTextFormatToolbarPlugin.test.tsx` mocks `FloatingTextFormatToolbar: () => null`, testing only `requestAnimationFrame` cleanup and zero toolbar interactions (color palette swatch selection, typography adjustments, bold/italic/underline toggles).
  3. `DragPlugin` has zero tests (neither the handle menu nor the target line component is tested).
  4. `SlashMenuPlugin.tsx` is untested (only individual node converters in `options.test.ts` are tested, but not the slash menu popup, keyboard navigation, or trigger matching).
- **Impact**: If the editor extension setup, toolbar buttons, slash menu popover, or drag-and-drop mechanics break, all tests will continue to pass.
- **Recommendation**:
  1. Add tests for `Nova.tsx` validating the integration of collaborative extensions and plugins.
  2. Add unit tests for `FloatingTextFormatToolbar` verifying button dispatch and color selection.
  3. Test `SlashMenuPlugin` typing triggers (`/`), keyboard selection (`ArrowDown`, `Enter`), and dismissal.

#### 6. Missing Global Teardown & Arbitrary Microtask Flushing in BroadcastChannel Mock

- **Implementation status (2026-10-23)**: FIXED: reset and pending-delivery draining replace the fixed microtask count (6611776); generation guards also discard queued deliveries after reset. Cascade and reset regressions added.

- **Exact File Reference**: [src/test/broadcast-channel.ts:1-28](file:///home/maddock/concept/src/test/broadcast-channel.ts#L1-L28)
- **Description**:
  1. `TestBroadcastChannel.channels` is a static global `Set<TestBroadcastChannel>`. It lacks any `reset()` or teardown helper. If an unhandled error occurs during a test, unclosed channel instances leak into the static set, causing assertions like `expect(TestBroadcastChannel.channels.size).toBe(0)` in [library-channel.test.ts:17](file:///home/maddock/concept/src/lib/documents/library-channel.test.ts#L17) and [local-provider.test.ts:20](file:///home/maddock/concept/src/lib/documents/local-provider.test.ts#L20) to fail unpredictably.
  2. `flushBroadcasts()` relies on an arbitrary hardcoded loop:
     ```ts
     export async function flushBroadcasts() {
       for (let step = 0; step < 12; step++) await Promise.resolve()
     }
     ```
- **Impact**: Hardcoded microtask loops are non-deterministic. If an internal asynchronous chain exceeds 12 microtasks or schedules a macrotask/timer, `flushBroadcasts()` completes prematurely before message delivery occurs, causing intermittent CI test failures.
- **Recommendation**:
  - Add a static `TestBroadcastChannel.reset()` method that closes and clears all registered channels.
  - Implement a queue-based drain or microtask check in `flushBroadcasts()` that flushes until no further messages are pending in the event queue.

#### 7. Missing Vitest Lifecycle Configuration & Global JSDOM Overhead

- **Implementation status (2026-10-23)**: FIXED: shared setup, clearMocks/restoreMocks/unstubGlobals, browser polyfills and node auth environment (ad55099). mockReset deliberately omitted: it would erase intentional default mock implementations. Existing node annotations retained. File isolation remains enabled.

- **Exact File Reference**: [vitest.config.ts:14-17](file:///home/maddock/concept/vitest.config.ts#L14-L17)
- **Description**:
  1. `environment: 'jsdom'` is applied globally to all test files. JSDOM initialization ran 39 times and took 88.77s (~46% of test run time). Pure backend/server files like [src/lib/auth/server.test.ts](file:///home/maddock/concept/src/lib/auth/server.test.ts) (20 tests, 310 lines) spin up JSDOM unnecessarily.
  2. `vitest.config.ts` does not configure `clearMocks: true`, `mockReset: true`, or `restoreMocks: true`.
  3. No `setupFiles` entry exists. Every UI test file independently stubs `IS_REACT_ACT_ENVIRONMENT`, `window.matchMedia`, `ResizeObserver`, etc., often with conflicting teardown patterns (e.g. `Object.assign(globalThis)` vs `vi.stubGlobal`).
- **Recommendation**:
  - Add a shared setup file (`setupFiles: ['./src/test/setup.ts']`) defining standard browser polyfills and default cleanups (`afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); })`).
  - Add `// @vitest-environment node` to pure server-side test files (`src/lib/auth/server.test.ts`).

---

### Medium Severity

#### 8. Flaky Tests Relying on Real Wall-Clock Timers (`setTimeout`)

- **Implementation status (2026-10-23)**: FIXED: virtual list/menu/toast waits use controlled timeout timers; overlapping Drive saves wait on authorization evidence; local storage advances beyond debounce. Existing assertions retained.

- **Exact File References**:
  - [src/components/documents/DocumentList.virtual.test.tsx:80, 105, 117, 123](file:///home/maddock/concept/src/components/documents/DocumentList.virtual.test.tsx#L80): `await new Promise((resolve) => setTimeout(resolve, 10))`
  - [src/components/documents/navigation-menus/DocumentMenu.test.tsx:68](file:///home/maddock/concept/src/components/documents/navigation-menus/DocumentMenu.test.tsx#L68): `await new Promise((resolve) => setTimeout(resolve, 0))`
  - [src/components/documents/navigation-menus/use-edit-actions.test.tsx:185](file:///home/maddock/concept/src/components/documents/navigation-menus/use-edit-actions.test.tsx#L185): `await new Promise((resolve) => setTimeout(resolve, 20))`
  - [src/lib/documents/drive/server.test.ts:361](file:///home/maddock/concept/src/lib/documents/drive/server.test.ts#L361): `await new Promise((resolve) => setTimeout(resolve, 0))`
  - [src/lib/documents/workspace-storage.test.ts:58](file:///home/maddock/concept/src/lib/documents/workspace-storage.test.ts#L58): `await new Promise((resolve) => setTimeout(resolve, 10))`
- **Description**: Real `setTimeout` calls with arbitrary delays (0ms, 10ms, 20ms) are used to wait for React state updates, sonner toast notifications, virtual scroll adjustments, and concurrent server requests.
- **Impact**: In CI environments under high CPU load, Node's event loop can lag, causing these arbitrary delays to expire before background tasks finish, leading to non-deterministic test failures.
- **Recommendation**: Replace real `setTimeout` delays with `vi.useFakeTimers()` (`vi.advanceTimersByTime()`, `vi.runAllTimersAsync()`) or deterministic event promises / `vi.waitFor()`.

#### 9. Combinatorial Explosion Causing 17.5s Execution in `PageSetupDialog.test.tsx`

- **Implementation status (2026-10-23)**: FIXED: representative A4/Letter UI cases retain all three display units and custom precision; pure tests exercise every size, both orientations and all margin presets, including invalid A6 geometry. No production conversion API exists to unit-test separately; unit switching remains covered in UI.

- **Exact File Reference**: [src/components/documents/page-setup/PageSetupDialog.test.tsx:24-58](file:///home/maddock/concept/src/components/documents/page-setup/PageSetupDialog.test.tsx#L24-L58)
- **Description**: `PageSetupDialog.test.tsx` runs 10 page sizes (`it.each(Object.keys(PAGE_SIZES))`), each looping over 4 margin presets and 3 unit conversions ('Millimeters', 'Centimeters', 'Inches'). This creates **120 full React mount/unmount and form validation/submit cycles** in JSDOM.
- **Impact**: This single test file takes **17.55 seconds** to run, creating a severe bottleneck in local and CI test runs.
- **Recommendation**: Test the numerical unit conversion logic in a pure unit test file (`page-setup.test.ts`). In the React dialog test, test only 2 representative paper sizes (e.g. `A4` and `Letter`) across units. This will reduce execution time from 17.5s to <1s.

#### 10. False Positive Assertion in `local-provider.test.ts`

- **Implementation status (2026-10-23)**: STRENGTHENED: explicitly deferred persistence now proves zero channels before resolution and one after reconnect (72edfd0). Original report overstated the false positive: Promise.resolve continuations still run asynchronously, so same-turn reconnect was already exercised.

- **Exact File Reference**: [src/lib/documents/local-provider.test.ts:89-97](file:///home/maddock/concept/src/lib/documents/local-provider.test.ts#L89-L97)
- **Description**: The test `'does not leak channels when connecting again before persistence finishes loading'` claims to verify connection handling while persistence is in-flight:
  ```ts
  const first = peer()
  first.provider.connect()
  first.provider.disconnect()
  first.provider.connect()
  await flushBroadcasts()
  expect(TestBroadcastChannel.channels.size).toBe(1)
  ```
  However, `peer()` creates the mock persistence with `whenSynced: Promise.resolve()`. Persistence is already resolved before `first.provider.connect()` is called.
- **Impact**: The race condition where reconnection occurs _while_ persistence is still loading is never actually tested, creating a false positive test.
- **Recommendation**: Provide an unresolved promise to `peer()` for `whenSynced`, trigger `connect() -> disconnect() -> connect()`, and then resolve `whenSynced` to accurately verify channel de-duplication during loading.

#### 11. Weak Assertion in `workspace-storage.test.ts`

- **Implementation status (2026-10-23)**: FIXED: local mutation assertion runs after 1500ms controlled time, beyond the 1000ms remote debounce (46939e8). Parent sync tests and production implementation preserved.

- **Exact File Reference**: [src/lib/documents/workspace-storage.test.ts:54-60](file:///home/maddock/concept/src/lib/documents/workspace-storage.test.ts#L54-L60)
- **Description**: The test `'never requests remote credentials for local documents'` checks that local document mutations do not trigger cloud saves:
  ```ts
  const document = await localDocumentStorage.create()
  const { doc } = await open(document.id)
  doc.getMap('metadata').set('test', true)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(save).not.toHaveBeenCalled()
  ```
  However, `workspace-storage.ts` uses a 1000ms debounce timer for syncing (`setTimeout(() => void sync(), 1000)`).
- **Impact**: Waiting only 10ms means the test finishes before the debounce timer could ever fire. Even if a cloud sync had been erroneously scheduled for a local document, the test would still pass. Furthermore, an unhandled timer remains scheduled in the background after the test exits.
- **Recommendation**: Use `vi.useFakeTimers()`, advance the clock past the 1000ms debounce window (`vi.advanceTimersByTime(1500)`), and assert `save` was not called.

#### 12. Fragile `afterEach` Teardown in `library-channel.test.ts`

- **Implementation status (2026-10-23)**: FIXED: optional teardown handles and resets prevent secondary cleanup errors, while channel leak assertion is retained (1b800c7).

- **Exact File Reference**: [src/lib/documents/library-channel.test.ts:14-19](file:///home/maddock/concept/src/lib/documents/library-channel.test.ts#L14-L19)
- **Description**:
  ```ts
  afterEach(() => {
    unsubscribe()
    remote.close()
    expect(TestBroadcastChannel.channels.size).toBe(0)
    vi.unstubAllGlobals()
  })
  ```
- **Impact**: If a test fails before `unsubscribe = subscribeToLibrary(...)` is called, `afterEach` crashes with `TypeError: unsubscribe is not a function`. This masks the underlying test assertion failure with an unhelpful teardown error.
- **Recommendation**: Safe-guard the teardown call: `unsubscribe?.()`.

#### 13. Global `fetch` Pollution in `drive/server.test.ts`

- **Implementation status (2026-10-23)**: FIXED: explicit unstubAllGlobals cleanup added (97803ea), reinforced by config. Vitest default per-file isolation already limits cross-file pollution; restoration still protects later tests in this file.

- **Exact File Reference**: [src/lib/documents/drive/server.test.ts:65](file:///home/maddock/concept/src/lib/documents/drive/server.test.ts#L65)
- **Description**: `beforeEach` stubs the global fetch object (`vi.stubGlobal('fetch', mocks.fetch)`), but the file does not include an `afterEach` calling `vi.unstubAllGlobals()`.
- **Impact**: Global `fetch` remains hijacked across any subsequent test files executed in the same worker thread.
- **Recommendation**: Add `afterEach(() => { vi.unstubAllGlobals() })`.

#### 14. Calling React `act()` Inside `vi.waitFor` Polling Callbacks

- **Implementation status (2026-10-23)**: FIXED: real storage lifecycle promise is awaited within act; waitFor callbacks only assert (3b93b65). Wrapping polling itself in act was tested and rejected because it defers the commit being asserted.

- **Exact File Reference**: [src/components/documents/DocumentEditor.test.tsx:71-78, 117-123](file:///home/maddock/concept/src/components/documents/DocumentEditor.test.tsx#L71-L78)
- **Description**:
  ```ts
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(...)
  })
  ```
- **Impact**: `vi.waitFor` repeatedly executes its callback until assertions pass or a timeout occurs. Calling React `act()` inside each polling iteration can cause interleaved promise/timer scheduling and react console warnings.
- **Recommendation**: Wrap state-changing triggers in `act()`, and keep `vi.waitFor` callbacks purely synchronous and declarative.

---

### Low Severity

#### 15. Unused Test Imports

- **Implementation status (2026-10-23)**: DISCARDED: conceptFileSize is used in the byte-size assertion; serializeConcept is used twice in sync-status byte-size assertions. Removing either import would break tests.

- **Exact File References**:
  - [src/lib/documents/concept-file.test.ts:7](file:///home/maddock/concept/src/lib/documents/concept-file.test.ts#L7): `conceptFileSize` is imported from `./serialization` but never used.
  - [src/components/documents/DocumentSyncStatus.test.tsx:8](file:///home/maddock/concept/src/components/documents/DocumentSyncStatus.test.tsx#L8): `serializeConcept` is imported from `#/lib/documents/serialization` but never used.
- **Impact**: Dead code in test fixtures.
- **Recommendation**: Remove unused imports.

#### 16. Destructive Global Overwriting of Browser Built-ins

- **Implementation status (2026-10-23)**: FIXED: URL methods and navigator clipboard/platform are mocked individually (52ab115); URL remains constructible. Clipboard polyfills supplied only where absent.

- **Exact File References**:
  - [src/lib/documents/export/export.test.ts:83](file:///home/maddock/concept/src/lib/documents/export/export.test.ts#L83):
    ```ts
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    ```
    Replaces the entire `URL` constructor with an object literal, breaking `new URL(...)` if called anywhere during the test.
  - [src/components/documents/navigation-menus/use-edit-actions.test.tsx:87](file:///home/maddock/concept/src/components/documents/navigation-menus/use-edit-actions.test.tsx#L87):
    ```ts
    vi.stubGlobal('navigator', { platform: 'Linux', clipboard: ... })
    ```
    Replaces the entire `navigator` global object rather than mocking `navigator.clipboard`.
- **Recommendation**: Spy on specific prototype methods (`vi.spyOn(URL, 'createObjectURL')`, `vi.spyOn(navigator.clipboard, 'readText')`) instead of replacing global constructors.

#### 17. Missing Tests for Peripheral Routes & Leaf Components

- **Implementation outcome (2026-10-23): FIXED — Confirmed the listed leaf components and route wrappers lacked direct tests. Added file picker selection/reading state, rename submit/validation/cancel, context menu rename/delete and Drive retention messaging, not-found navigation, auth GET/POST request forwarding, index/new component wiring and document route param forwarding. See `src/test/routes.test.tsx` and the four new component test files. These are route contracts and JSDOM interaction tests, not deployed HTTP/browser navigation tests.**

- **Exact File References**:
  - `src/routes/api/auth/$.ts` (Better Auth HTTP route endpoint)
  - `src/routes/d/$id.tsx`, `src/routes/new/index.tsx`, `src/routes/d/index.tsx`
  - `src/components/documents/DocumentFilePicker.tsx`
  - `src/components/documents/RenameDocumentDialog.tsx`
  - `src/components/documents/DocumentContextMenu.tsx`
  - `src/components/not-found.tsx`
- **Impact**: Lower severity as these are thin wrappers, but changes to routing contracts or UI dialog hooks could regress without test detection.
- **Recommendation**: Add smoke/rendering tests for route components and auxiliary dialogs.

---

## 3. Summary Action Plan & Prioritized Recommendations

| Priority           | Action                                                                                           | Target Files                                                                                                                                                 |
| :----------------- | :----------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 (Immediate)** | Fix invalid `localDocumentStorage` import path to resolve 4 failing tests                        | `src/components/documents/DocumentDetails.test.tsx`<br>`src/components/documents/DocumentEditor.test.tsx`<br>`src/components/documents/NewDocument.test.tsx` |
| **P0 (Immediate)** | Stop mutating `workspaceDocumentStorage` singleton with `Object.assign`                          | `src/hooks/use-documents.test.tsx`                                                                                                                           |
| **P1**             | Add centralized test setup (`setupFiles`) and mock reset defaults (`clearMocks`, `restoreMocks`) | `vitest.config.ts`, `src/test/setup.ts`                                                                                                                      |
| **P1**             | Add static cleanup and deterministic flush to `TestBroadcastChannel`                             | `src/test/broadcast-channel.ts`                                                                                                                              |
| **P1**             | Implement integration tests for `DocumentWorkspace`                                              | `src/components/documents/DocumentWorkspace.test.tsx`                                                                                                        |
| **P1**             | Implement unit tests for storage transfer                                                        | `src/lib/documents/transfer.test.ts`                                                                                                                         |
| **P2**             | Add tests for `Nova.tsx`, `FloatingTextFormatToolbar`, and `SlashMenuPlugin`                     | `src/components/nova/**/*.test.*`                                                                                                                            |
| **P2**             | Replace real timers (`setTimeout`) with `vi.useFakeTimers()`                                     | `DocumentList.virtual.test.tsx`<br>`DocumentMenu.test.tsx`<br>`workspace-storage.test.ts`                                                                    |
| **P2**             | Eliminate combinatorial rendering loop in `PageSetupDialog.test.tsx`                             | `PageSetupDialog.test.tsx`                                                                                                                                   |
| **P3**             | Partition test environments (`node` for server tests, `jsdom` for UI tests)                      | `vitest.config.ts`, `src/lib/auth/server.test.ts`                                                                                                            |
