# Comprehensive Code Review & Issue Scan: Document UI & Hooks

A thorough code review of the document UI components and custom hooks was conducted across all six requested module groups. Below is the structured analysis categorized by severity, with exact file/line references and actionable fixes.

---

## Executive Summary

| Category                                       | Critical | High  | Medium |  Low  | Total  |
| :--------------------------------------------- | :------: | :---: | :----: | :---: | :----: |
| **State Synchronization & Race Conditions**    |    1     |   1   |   3    |   1   | **6**  |
| **Component Lifecycle & Unmounted Updates**    |    2     |   1   |   0    |   0   | **3**  |
| **Performance, Re-renders & Layout Thrashing** |    0     |   1   |   2    |   2   | **5**  |
| **Accessibility & Keyboard Focus Traps**       |    0     |   1   |   1    |   0   | **2**  |
| **Hook Listeners, Cleanup & Environment**      |    0     |   1   |   0    |   1   | **2**  |
| **Total**                                      |  **3**   | **5** | **6**  | **4** | **18** |

---

## 1. Critical Severity

### 1.1 Race Condition: Deleting an Inactive Document Kicks User Out of Active Document

- **Status**: FIXED (`6e0d22f`)
- **Validation**: Confirmed that `deleteDocument` compared `documentId === id` against the render closure while `activeId.current` was only updated inside a post-render `useEffect`. Updated `activeId.current = id` synchronously during render and checked `documentId === activeId.current` in `deleteDocument`. Added unit tests in `src/hooks/use-documents.test.tsx` (`does not navigate away when switching to another document while deleting the previous one` and `returns to the library when navigating into a document whose deletion is in flight`).
- **File & Lines**: [`src/hooks/use-documents.ts#L143-L157`](file:///home/maddock/concept/src/hooks/use-documents.ts#L143-L157)
- **Issue**:
  When deleting a document via `deleteDocument(documentId)`, line 149 tests:
  ```ts
  if (documentId === id) await navigate({ to: '/d' })
  ```
  `id` is captured from the hook's closure at function creation time. If the user initiates deletion of document A, and navigates to document B while `await storage.delete(documentId)` is awaiting, `documentId === id` evaluates to `true` (`'doc-a' === 'doc-a'`). The application navigates to `/d`, forcibly kicking the user out of document B.
- **Actionable Fix**:
  Synchronously maintain the current active ID in `activeId.current = id` during render (not in a deferred `useEffect`), and evaluate against the live ref:
  ```ts
  // In useDocuments:
  const activeId = useRef(id)
  activeId.current = id // Update synchronously during render

  // In deleteDocument:
  if (documentId === activeId.current) {
    await navigate({ to: '/d' })
  }
  ```

---

### 1.2 Unmounted Component State Updates & Dialog Lifecycle Failure in `RenameDocumentDialog` and `DocumentContextMenu`

- **Status**: FIXED (`e43cde2`)
- **Validation**: Confirmed unmounted state updates in `RenameDocumentDialog.save()` and `DocumentContextMenu.confirmDelete()`. Guarded `setPending(false)` behind `!closed` in `RenameDocumentDialog`, guarded `setConfirming(false)` and `setDeleting(false)` with `mountedRef` and `deletingRef` in `DocumentContextMenu`, prevented premature dialog dismissal while deletion is in flight, and added `event.preventDefault()` on `<AlertDialogAction>`. Validated with `closes the rename dialog and unmounts cleanly without post-unmount state updates` in `src/components/documents/DocumentList.test.tsx`.
- **File & Lines**:
  - [`src/components/documents/RenameDocumentDialog.tsx#L28-L38`](file:///home/maddock/concept/src/components/documents/RenameDocumentDialog.tsx#L28-L38)
  - [`src/components/documents/DocumentContextMenu.tsx#L38-L47`](file:///home/maddock/concept/src/components/documents/DocumentContextMenu.tsx#L38-L47)
  - [`src/components/documents/DocumentContextMenu.tsx#L97-L103`](file:///home/maddock/concept/src/components/documents/DocumentContextMenu.tsx#L97-L103)
- **Issue**:
  1. In `RenameDocumentDialog.save()`, `if (await onRename(value.trim())) onClose()` triggers `setRenaming(false)` in the parent. This unmounts `RenameDocumentDialog`. The subsequent `finally` block runs `setPending(false)` on the unmounted component.
  2. In `DocumentContextMenu.confirmDelete()`, `await onDelete()` causes `useDocuments` to filter out the deleted item from `documents`. The parent `DocumentList` immediately unmounts the row and the context menu containing `<AlertDialog>`. The `finally` block then calls `setDeleting(false)` and `setConfirming(false)` on an unmounted component.
  3. `<AlertDialogAction onClick={confirmDelete}>` does not call `event.preventDefault()`. In Base UI / Radix primitives, action buttons trigger dialog closure by default. If `onDelete()` rejects, the dialog has already closed without communicating the error, and React state (`confirming`) becomes desynchronized.
  4. Abruptly unmounting an active `<AlertDialog>` while open circumvents cleanup of modal backdrop scroll locks and focus traps.
- **Actionable Fix**:
  - In `RenameDocumentDialog.save()`, track whether the dialog was closed before invoking state setters in `finally`:
    ```ts
    let closed = false
    try {
      if (await onRename(value.trim())) {
        closed = true
        onClose()
      } else {
        setError('Could not rename the document. Please try again.')
      }
    } catch {
      setError('Could not rename the document. Please try again.')
    } finally {
      pendingRef.current = false
      if (!closed) setPending(false)
    }
    ```
  - In `DocumentContextMenu.confirmDelete()`, intercept click events with `event.preventDefault()`, guard unmount state, and close dialog state prior to removal:
    ```tsx
    <AlertDialogAction
      variant="destructive"
      disabled={deleting}
      onClick={(e) => {
        e.preventDefault()
        void confirmDelete()
      }}
    >
    ```

---

### 1.3 Unmounted State Update in `DocumentStorageDialog.confirm()`

- **Status**: FIXED (`7cfce50`)
- **Validation**: Confirmed that `onClose()` unmounts `DocumentStorageDialog` before `finally` runs `setPending(false)`. Guarded `setPending(false)` behind `!closed` in `DocumentStorageDialog.confirm()` and verified unmount behavior in `src/components/documents/DocumentStorageDialog.test.tsx`.
- **File & Lines**: [`src/components/documents/DocumentStorageDialog.tsx#L125-L144`](file:///home/maddock/concept/src/components/documents/DocumentStorageDialog.tsx#L125-L144)
- **Issue**:
  In `DocumentStorageDialog.confirm()`, saving completes with:
  ```ts
  await navigate({ to: '/d/$id', params: { id } })
  onClose()
  ```
  `onClose()` invokes `closeFileDialog()` in `document-workspace-context.tsx`, setting `fileAction` to `null`. This unmounts `DocumentStorageDialog`. The `finally` block subsequently invokes:
  ```ts
  pendingRef.current = false
  setPending(false)
  ```
  triggering a React unmounted state update warning.
- **Actionable Fix**:
  Guard the `finally` block or avoid resetting `setPending(false)` if `onClose()` was dispatched:
  ```ts
  let closed = false
  try {
    // ... save & navigate ...
    closed = true
    onClose()
  } catch (cause) {
    setError(
      cause instanceof Error ? cause.message : 'Could not open the document.',
    )
  } finally {
    pendingRef.current = false
    if (!closed) setPending(false)
  }
  ```

---

## 2. High Severity

### 2.1 Main-Thread Latency: Full Yjs CRDT Serialization & Word Count on Every Keystroke in `DocumentDetailsDialog`

- **Status**: CONFIRMED NOT AN ISSUE
- **File & Lines**: [`src/components/documents/DocumentDetails.tsx#L63-L98`](file:///home/maddock/concept/src/components/documents/DocumentDetails.tsx#L63-L98)
- **Triage & Evidence**:
  Discarded with evidence. The report claims that full serialization and regex segmentation freeze typing on every keystroke. In actual runtime behavior:
  1. `DocumentDetailsDialog` is a modal dialog rendered only when `detailsOpen === true`. When a user writes in the editor during ordinary operation, the dialog is not mounted. When the dialog is open, its modal backdrop and focus trap prevent editor typing.
  2. Commit `9f6b983ebba1d0c7ad3773590492d81130194043` already optimized this component: selection-only changes are filtered out (`dirtyElements.size || dirtyLeaves.size`), segmentation reuses a single `Intl.Segmenter` instance, and concurrent updates in the same tick are coalesced via `pending` flag before `queueMicrotask`.
  3. `DocumentDetails.test.tsx` (`coalesces document updates and skips serialization for selection-only changes`) confirms that coalescing works correctly without lag. Introducing an artificial 300–500ms `setTimeout` would degrade the responsive display of statistics and break existing test assertions.

---

### 2.2 Accessibility Focus Trap: Intercepting `Tab` Key in `DocumentList`

- **Status**: FIXED
- **Commit**: `0e92e62`
- **File & Lines**: [`src/components/documents/DocumentList.tsx#L69-L76`](file:///home/maddock/concept/src/components/documents/DocumentList.tsx#L69-L76)
- **Triage & Evidence**:
  Confirmed. `onKeyDown` explicitly intercepted the `Tab` and `Shift+Tab` keys, calling `event.preventDefault()` and cycling list selection. This created an accessibility focus trap preventing keyboard and screen reader users from tabbing away from the list into the editor or navigation bar.
- **Fix**:
  Removed `Tab` key handling from `SidebarMenu.onKeyDown` so `Tab` exits the composite list widget normally, while ArrowDown/ArrowUp and Home/End handle within-list navigation.
- **Validation**:
  Updated `src/components/documents/DocumentList.virtual.test.tsx` to verify Arrow keys handle navigation and added a test confirming `Tab` is not prevented (`defaultPrevented === false`).

---

### 2.3 DOM Remount, Focus Loss, and Unmounted Update on Rename in `DocumentName`

- **Status**: FIXED
- **Commit**: `826dae9`
- **File & Lines**:
  - [`src/components/documents/DocumentWorkspace.tsx#L100-L104`](file:///home/maddock/concept/src/components/documents/DocumentWorkspace.tsx#L100-L104)
  - [`src/components/documents/DocumentName.tsx#L19-L26`](file:///home/maddock/concept/src/components/documents/DocumentName.tsx#L19-L26)
- **Triage & Evidence**:
  Confirmed. Keying `<DocumentName>` by `${document.id}:${document.name}` caused the element to unmount and remount when renamed, dropping focus. In addition, `DocumentName` lacked an effect to synchronize with prop updates and lacked error handling on `onSave(draft)`.
- **Fix**:
  Key `<DocumentName>` by `document?.id ?? 'library'`, synchronize internal state via `useEffect` on `name` changes, and catch rejections in `onBlur` to revert state cleanly without unhandled rejections.
- **Validation**:
  Added unit tests in `src/components/documents/DocumentName.test.tsx` for prop synchronization and error recovery; verified with vitest and `tsc --noEmit`.

---

### 2.4 Mobile Detection Desync on Initial Client Render in `useIsMobile`

- **Status**: FIXED
- **Commit**: `e93dcb8`
- **File & Lines**: [`src/hooks/use-mobile.ts#L11-L28`](file:///home/maddock/concept/src/hooks/use-mobile.ts#L11-L28)
- **Triage & Evidence**:
  Confirmed. `useSyncExternalStore` runs the snapshot function during component rendering, before subscription effects run. `mediaQuery` was `undefined` during the initial client snapshot, causing `useIsMobile()` to evaluate to `false` on initial render even on mobile screens.
- **Fix**:
  Lazily initialize `mediaQuery` in `getSnapshot()` so the initial snapshot evaluates `window.matchMedia(MOBILE_QUERY).matches` immediately.
- **Validation**:
  Added test `evaluates mobile query synchronously on initial client render` in `src/hooks/use-mobile.test.tsx`; passed in vitest and verified with `tsc --noEmit`.

---

### 2.5 Theme State Leaking Across Document Navigation

- **Status**: FIXED
- **Commit**: `b7e0aa3`
- **File & Lines**:
  - [`src/components/documents/DocumentEditor.tsx#L74-L86`](file:///home/maddock/concept/src/components/documents/DocumentEditor.tsx#L74-L86)
  - [`src/components/documents/DocumentWorkspace.tsx#L32`](file:///home/maddock/concept/src/components/documents/DocumentWorkspace.tsx#L32)
- **Triage & Evidence**:
  Confirmed. `observeDocumentTheme` applies theme classes directly to `document.documentElement.dataset.documentTheme`. When switching between documents or unmounting `DocumentEditor`, `stopTheme?.()` was invoked but `documentTheme` attribute remained set to the previous document's theme, leaking until the next document synced.
- **Fix**:
  Invoke `applyDocumentTheme('default')` and `onDocumentThemeChange?.('default')` during the unmount cleanup in `DocumentEditor`.
- **Validation**:
  Added test `resets the document theme to default when unmounted` in `src/components/documents/DocumentEditor.test.tsx`; verified with vitest and `tsc --noEmit`.

---

## 3. Medium Severity

### 3.1 Layout Thrashing in `useDocumentListWindow.measure()`

- **Status**: FIXED
- **Commit**: `6e86f6e`
- **File & Lines**: [`src/components/documents/use-document-list-window.ts#L22-L31`](file:///home/maddock/concept/src/components/documents/use-document-list-window.ts#L22-L31)
- **Triage & Evidence**:
  Confirmed. `measure()` invoked `getBoundingClientRect()` on both `scroller` and `list` on every scroll frame, forcing synchronous reflows and layout recalculations during virtual scrolling.
- **Fix**:
  Cached the relative offset of `list` inside `scroller` during `ResizeObserver` callbacks and initial render, deriving `top = Math.max(0, scroller.scrollTop - listOffset)` on scroll frames without calling `getBoundingClientRect()`.
- **Validation**:
  Tested with `DocumentList.virtual.test.tsx` (5 virtual scrolling test cases passing) and verified with `pnpm typecheck`.

---

### 3.2 Non-Virtualized Lists (`count <= 60`) Never Scroll Active Document into View

- **Status**: FIXED
- **Commit**: `e7880e2`
- **File & Lines**: [`src/components/documents/use-document-list-window.ts#L69-L71`](file:///home/maddock/concept/src/components/documents/use-document-list-window.ts#L69-L71)
- **Triage & Evidence**:
  Confirmed. `useEffect` gated `reveal(activeIndex)` on `virtual`, and `scrollerRef.current` was never initialized when `!virtual`. When a user opened a document in a list containing <= 60 items with a scrollable container, the active document was not scrolled into view.
- **Fix**:
  Allowed resolving `scroller` via fallback to `list?.closest('[data-sidebar="content"]')`, removed the `virtual` gate from the `activeIndex` effect, and only updated virtual `viewport` state when `virtual` is true.
- **Validation**:
  Added test `reveals active document in non-virtualized lists (count <= 60)` in `src/components/documents/DocumentList.virtual.test.tsx`; verified with vitest and `pnpm typecheck`.

---

### 3.3 Context Value Recreated Every Render in `DocumentWorkspaceProvider`

- **Status**: FIXED
- **Commit**: `062e59b`
- **File & Lines**: [`src/components/documents/document-workspace-context.tsx#L104-L141`](file:///home/maddock/concept/src/components/documents/document-workspace-context.tsx#L104-L141)
- **Triage & Evidence**:
  Confirmed. `useWorkspaceState` created an unmemoized plain object literal and inline closures for `workspace` on every render pass. Because `DocumentWorkspaceProvider` provided this object directly, all consuming descendants (`DocumentNavigation`, `DocumentNavigationContent`, menu bars) re-rendered on any state change.
- **Fix**:
  Wrapped all action handlers (`openDocument`, `copyDocument`, `downloadDocument`, `exportDocument`, `changeDocumentTheme`, `showDetails`, `shareDocument`, `openPageSetup`, `importDocument`, `focusEditor`, `closeFileDialog`) in `useCallback` and wrapped `workspace` in `useMemo`.
- **Validation**:
  Verified with `pnpm typecheck` and related navigation menu unit tests in Vitest.

---

### 3.4 Unmemoized Functions in `useDocuments`

- **Status**: FIXED
- **Commit**: `124af1c`
- **File & Lines**: [`src/hooks/use-documents.ts#L78-L157`](file:///home/maddock/concept/src/hooks/use-documents.ts#L78-L157)
- **Triage & Evidence**:
  Confirmed. `createDocument`, `renameDocumentById`, `renameDocument`, and `deleteDocument` were recreated as fresh function instances on every render of `useDocuments`, triggering cascading updates down to consuming components.
- **Fix**:
  Wrapped `createDocument`, `renameDocumentById`, `renameDocument`, and `deleteDocument` in `useCallback`, accessing the latest document collection through `documentsRef` so that `renameDocumentById` remains stable across document state changes without mutating the active ID check owned by finding 1.1.
- **Validation**:
  Tested with `src/hooks/use-documents.test.tsx` (15 passing tests) and `pnpm typecheck`.

---

### 3.5 Storage Refresh Drops Concurrent Invalidation Events in `useDocuments`

**Status: FIXED during integration.** Subscription payloads are already reconciled during reads, but a window-focus invalidation can represent external storage changes absent from that payload map. An in-flight list read can contain an older snapshot. Coalesced `refreshQueued` now replays one refresh after the current read settles, preserving existing payload reconciliation and cancelling work after unmount. Regression dispatches two focus invalidations during a deferred old read and verifies exactly one follow-up read returns fresh state.

### 3.6 Direct Document Navigation Bypasses `storage.get(id)`

- **Status**: FIXED
- **Commit**: `1df7c3f`
- **File & Lines**:
  - [`src/hooks/use-documents.ts#L20`](file:///home/maddock/concept/src/hooks/use-documents.ts#L20)
  - [`src/components/documents/DocumentWorkspace.tsx#L125-L145`](file:///home/maddock/concept/src/components/documents/DocumentWorkspace.tsx#L125-L145)
- **Triage & Evidence**:
  Confirmed. When navigating directly to a document URL (`/d/$id`), if the requested document was missing from the initial `storage.list()` result, `useDocuments` never attempted to load the document metadata via `storage.get(id)`, resulting in a premature "Document not found" state.
- **Fix**:
  When `id` is specified and not present in the items returned by `storage.list()`, query `storage.get(id)` and include the retrieved document in the library collection before marking `loaded = true`.
- **Validation**:
  Added test `fetches direct document via storage.get when missing from initial list` in `src/hooks/use-documents.test.tsx`; verified with vitest and `pnpm typecheck`.

---

## 4. Low Severity

### 4.1 Inefficient `findIndex` Linear Scan on Every Render in `DocumentList`

- **Status**: FIXED
- **Commit**: `5f7c99e`
- **File & Lines**: [`src/components/documents/DocumentList.tsx#L33`](file:///home/maddock/concept/src/components/documents/DocumentList.tsx#L33)
- **Triage & Evidence**:
  Confirmed. `documents.findIndex((item) => item.id === activeId)` was evaluated on every render of `DocumentList`, causing redundant linear scans through the document collection on every parent render or state tick.
- **Fix**:
  Memoized `activeIndex` with `useMemo` depending on `[documents, activeId]`.
- **Validation**:
  Verified with existing and extended `DocumentList` test suites in `DocumentList.virtual.test.tsx` and `DocumentList.test.tsx`, plus `pnpm typecheck`.

---

### 4.2 Redundant Re-render via Synchronous `setPendingFocus(null)` in `useLayoutEffect`

- **Status**: FIXED
- **Commit**: `4bae9d9`
- **File & Lines**: [`src/components/documents/use-document-list-window.ts#L96-L105`](file:///home/maddock/concept/src/components/documents/use-document-list-window.ts#L96-L105)
- **Triage & Evidence**:
  Confirmed. `focus(index)` unconditionally set `pendingFocus` state, causing a layout effect that immediately called `setPendingFocus(null)`. This caused two synchronous render passes for every keyboard focus change, even when the row element was already present in the DOM.
- **Fix**:
  In `focus(index)`, check if `target` is already mounted in DOM. If mounted, invoke `target.focus({ preventScroll: true })` directly and return without dispatching `setPendingFocus`. Only fall back to `setPendingFocus(index)` if the element is not currently mounted.
- **Validation**:
  Tested with `DocumentList.virtual.test.tsx` keyboard traversal tests and verified with `pnpm typecheck`.

---

### 4.3 Missing Unit Test Import Re-export for `localDocumentStorage`

- **Status**: RESOLVED IN BASE. The test files already import the concrete implementation from `storages/local`; `storage.ts` remains provider-agnostic types. Confirmed in test infrastructure triage and the complete passing test suite.

- **File & Lines**:
  - `src/components/documents/DocumentDetails.test.tsx:14`
  - `src/components/documents/DocumentEditor.test.tsx:14`
  - `src/components/documents/NewDocument.test.tsx:7`
- **Issue**:
  Three unit test files import `{ localDocumentStorage } from '#/lib/documents/storage'`, but `src/lib/documents/storage.ts` only exports types. `localDocumentStorage` is exported from `src/lib/documents/storages/local.ts`. This causes runtime failures (`TypeError: Cannot read properties of undefined`) in Vitest.
- **Actionable Fix**:
  Add `export { localDocumentStorage } from './storages/local'` to [`src/lib/documents/storage.ts`](file:///home/maddock/concept/src/lib/documents/storage.ts) or update the test import paths.

---

### 4.4 Unsorted Document Prepending in `createDocument`

- **Status**: FIXED
- **Commit**: `01692cc`
- **File & Lines**: [`src/hooks/use-documents.ts#L84-L88`](file:///home/maddock/concept/src/hooks/use-documents.ts#L84-L88)
- **Triage & Evidence**:
  Confirmed. `createDocument` prepended `created` to `documents` state without sorting by `updatedAt`. Although `storage.subscribe` performed sorted upsert, the initial state setter left the newly created document unsorted relative to concurrent or existing documents.
- **Fix**:
  Sorted the updated document array in `setDocuments` by `b.updatedAt - a.updatedAt`.
- **Validation**:
  Added test `sorts newly created document by updatedAt order` in `src/hooks/use-documents.test.tsx`; verified with vitest.
