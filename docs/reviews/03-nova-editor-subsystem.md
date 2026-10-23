# Nova Rich-Text Editor Subsystem: Comprehensive Code Review & Bug Hunt

This review covers the core Nova editor components (`Nova.tsx`, `NovaContentEditable.tsx`, `editor.ts`, `initial-state.ts`, `paragraph-format.ts`, `theme.ts`), plugins (`DragPlugin`, `FormatToolbarPlugin`, `SlashMenuPlugin`), utility functions (`getDOMRangeRect.ts`, `getSelectedNode.ts`), and their integration with markdown serialization and document updates in `src/lib/documents/`.

---

## Executive Summary

| Severity     | Count | Primary Impact Areas                                                                                               |
| :----------- | :---: | :----------------------------------------------------------------------------------------------------------------- |
| **Critical** |   2   | Application crash on regex syntax in slash menu; Editor state corruption from nested transactions                  |
| **High**     |   3   | Stale selection race conditions; Layout thrashing & performance bottlenecks; Selection jump to document top        |
| **Medium**   |   4   | Missing `CodeNode` registration; Unbounded RAF polling loop; IME composition collisions; Mobile touch drag failure |
| **Low**      |   2   | DOM allocation churn in `$decorateDOM`; Hardcoded LTR layout for placeholders                                      |

---

## 1. Critical Severity

### 1.1 Unescaped Regex in Slash Menu Triggers Uncaught `SyntaxError` Crash

- **File & Line**: [`src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L27`](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L27)
- **Root Cause**:
  `new RegExp(queryString, 'i')` directly compiles raw user input from the slash typeahead query. If the user types any regular expression special character (such as `/[`, `/*`, `/(`, `/+`, `/?`, or `/\`), JavaScript throws an uncaught `SyntaxError: Invalid regular expression`. Because this occurs inside the React render phase (`useMemo`), it immediately crashes the React component tree and breaks user input.
- **Impact**: Immediate application crash while typing standard math, brackets, or punctuation after a slash.
- **Actionable Fix**:
  Avoid regex or escape special characters before compilation:
  ```tsx
  // src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx
  const options = useMemo<BlockOption[]>(() => {
    const base = getBlockOptions(editor)
    if (!queryString) return base

    const query = queryString.toLowerCase()
    return base.filter(
      (o) =>
        o.title.toLowerCase().includes(query) ||
        o.keywords?.some((k) => k.toLowerCase().includes(query)),
    )
  }, [editor, queryString])
  ```

---

### 1.2 Triple-Nested `editor.update` and Re-entrant `dispatchCommand` in Slash Menu

- **Files & Lines**:
  - [`src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L32-L44`](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L32-L44)
  - [`src/components/nova/plugins/SlashMenuPlugin/options.tsx#L55-L135`](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/options.tsx#L55-L135)
- **Root Cause**:
  1. `@lexical/react/LexicalTypeaheadMenuPlugin` already wraps `onSelectOption` inside an `editor.update(...)` transaction.
  2. `SlashMenuPlugin.tsx` wraps its callback inside another `editor.update(...)`.
  3. Inside `selectedOption.onSelect()`, heading/paragraph options call `editor.update(...)` a third time, while list and horizontal-rule options dispatch commands (`INSERT_UNORDERED_LIST_COMMAND`, etc.) into the active update.
  4. Synchronously invoking `closeMenu()` (which calls React `setResolution(null)`) from inside the nested update causes React state updates to fight with Lexical's ongoing reconcile cycle.
  5. When `queryNode.remove()` runs on an otherwise empty paragraph, the selection collapses into an element anchor `{ key: paragraphKey, offset: 0, type: 'element' }`, which can cause subsequent block formatters (`$setBlocksType`) to fail or misplace cursor focus.
- **Impact**: Selection loss, skipped history stack entries, and editor reconciliation desynchronization when executing slash commands.
- **Actionable Fix**:
  Execute node transformations directly within the ambient `$` context without nesting `editor.update()`, and close the menu after the transaction finishes:
  ```tsx
  // src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx
  const onSelectOption = useCallback<OnSelectOptionCallback<BlockOption>>(
    (selectedOption, queryNode, closeMenu) => {
      // LexicalTypeaheadMenuPlugin already runs inside an editor.update()
      if (queryNode !== null && queryNode.isAttached()) {
        queryNode.remove()
      }
      selectedOption.onSelect()
      // Close menu outside of the direct transform to allow smooth unmount
      queueMicrotask(() => closeMenu())
    },
    [],
  )
  ```
  In `options.tsx`, remove redundant `editor.update()` calls from `onSelect` closures:
  ```tsx
  // src/components/nova/plugins/SlashMenuPlugin/options.tsx
  onSelect: () => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      $setBlocksType(
        selection,
        () => $createHeadingNode('h1'),
        $copyParagraphFormat,
      )
    }
  }
  ```

---

## 2. High Severity

### 2.1 Stale Cloned Selection and Race Conditions via `await Promise.resolve()` in `useFormatActions`

- **Status**: FIXED
- **Evidence & Validation**: Confirmed asynchronous microtask tick via `await Promise.resolve()` introduced race conditions on consecutive clicks and remote state updates. Removed `await Promise.resolve()` so selection reading and application execute synchronously without stale cloned selection interleaving. Added regression test in `src/components/documents/navigation-menus/use-format-actions.test.tsx` verifying rapid successive actions apply without stale selection races.
- **File & Line**: [`src/components/documents/navigation-menus/use-format-actions.ts#L180-L195`](file:///home/maddock/concept/src/components/documents/navigation-menus/use-format-actions.ts#L180-L195)
- **Root Cause**:
  ```tsx
  const selection = editor.getEditorState().read(() => $getSelection()?.clone())
  await Promise.resolve()
  editor.getRootElement()?.focus({ preventScroll: true })
  editor.update(() => {
    if (selection) $setSelection(selection)
    ...
  ```
  1. `run` clones the active selection and awaits a microtask tick (`await Promise.resolve()`).
  2. During this microtask tick, remote updates (from Yjs collaboration) or rapid keystrokes can mutate or delete the nodes referenced by `selection.anchor.key` and `selection.focus.key`.
  3. Restoring the cloned selection with `$setSelection(selection)` causes Lexical to throw `Error: Point.getNode: node not found` on the subsequent read or render pass.
  4. Rapid successive clicks (e.g. Bold then Italic) run concurrently, causing the second execution to restore the stale cloned selection from before the first action split or transformed text nodes.
- **Impact**: Crashes during collaborative editing or rapid formatting (`Point.getNode: node not found`), selection jumping, and formatting applied to wrong text nodes.
- **Actionable Fix**:
  Do not introduce asynchronous delays between reading and applying selection. Use `onMouseDown={(e) => e.preventDefault()}` on toolbar controls to prevent the editor from losing DOM focus:
  ```tsx
  // src/components/documents/navigation-menus/use-format-actions.ts
  function run(action: FormatAction) {
    const editor = editorRef.current
    if (!editor || !state.enabled) return

    editor.update(
      () => {
        if (action.kind === 'align') {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, action.value)
        } else if (action.kind === 'indent') {
          editor.dispatchCommand(
            action.value === 'increase'
              ? INDENT_CONTENT_COMMAND
              : OUTDENT_CONTENT_COMMAND,
            undefined,
          )
        } else if (action.kind === 'list') {
          editor.dispatchCommand(
            action.value === 'bullet'
              ? INSERT_UNORDERED_LIST_COMMAND
              : action.value === 'number'
                ? INSERT_ORDERED_LIST_COMMAND
                : action.value === 'check'
                  ? INSERT_CHECK_LIST_COMMAND
                  : REMOVE_LIST_COMMAND,
            undefined,
          )
        } else if (action.kind === 'text') {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, action.value)
        } else {
          $applyFormatAction(action)
        }
      },
      { tag: HISTORY_PUSH_TAG },
    )
  }
  ```

---

### 2.2 Layout Thrashing & Persistent Update Listeners in `ColorSelect` and `TypographyControls`

- **Files & Lines**:
  - [`src/components/nova/plugins/FormatToolbarPlugin/ColorSelect.tsx#L40-L60`](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/ColorSelect.tsx#L40-L60)
  - [`src/components/nova/plugins/FormatToolbarPlugin/TypographyControls.tsx#L61-L93`](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/TypographyControls.tsx#L61-L93)
  - [`src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbar.tsx#L123-L124`](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbar.tsx#L123-L124)
- **Root Cause**:
  1. `<ColorSelect sectionId="text-color" />` and `<ColorSelect sectionId="highlight" />` are always rendered in `FloatingTextFormatToolbar`, even when the toolbar is closed (`isOpen === false`).
  2. Both `ColorSelect` components register `editor.registerUpdateListener` callbacks that execute on **every single keystroke** anywhere in the document.
  3. In `TypographyControls.tsx`, `useTypography` loops over selected nodes and calls `getComputedStyle(element)` on every DOM node. Calling `getComputedStyle` repeatedly forces synchronous layout reflow and style invalidation.
  4. When the selection contains no text nodes (e.g. collapsed cursor in empty paragraph), `useTypography` and `ColorSelect` return early without calling `setValue` or `setCurrentColor`. This causes the controls to retain and display stale font families and colors from the previous selection.
- **Impact**: Significant input latency on large documents during rapid typing; UI displaying outdated font/color states.
- **Actionable Fix**:
  1. Only subscribe to editor updates when the popovers or controls are open:
     ```tsx
     // In ColorSelect.tsx
     export function ColorSelect({ sectionId, editor, active = true }: Props) {
       useEffect(() => {
         if (!active) return
         // register update listener only when active...
       }, [editor, active, sectionId])
     ```
  2. Inspect Lexical node styling (`$getSelectionStyleValueForProperty` or `node.getStyle()`) rather than invoking `getComputedStyle` in a loop across text elements.
  3. Clear state to default when selection is empty or collapsed:
     ```tsx
     if (!elements.length) {
       setCurrentColor(null)
       return
     }
     ```

---

### 2.3 `getDOMRangeRect` Jumps to Top of Document on Root Element Selection

- **Status**: FIXED
- **Evidence & Validation**: Confirmed that `points.anchorNode === rootElement` traversed `firstElementChild` to line 1 of the document. Replaced the traversal loop by resolving the focused node element within `rootElement` or returning an empty `DOMRect(0, 0, 0, 0)`. Validated with unit tests in `src/components/nova/utils/getDOMRangeRect.test.ts`.
- **File & Line**: [`src/components/nova/utils/getDOMRangeRect.ts#L10-L16`](file:///home/maddock/concept/src/components/nova/utils/getDOMRangeRect.ts#L10-L16)
- **Root Cause**:
  ```ts
  if (points.anchorNode === rootElement || range === null) {
    let inner = rootElement
    while (inner.firstElementChild != null) {
      inner = inner.firstElementChild as HTMLElement
    }
    return inner.getBoundingClientRect()
  }
  ```
  When selections are initiated at the editor root boundary (common when dragging across multiple blocks, clicking near margins, or during block selections), `points.anchorNode === rootElement`.
  The `while` loop traverses down `firstElementChild` to the very first node of the document (line 1, paragraph 1). `getDOMRangeRect` returns the bounding box of the top-most line of the document, causing the floating toolbar to jump hundreds or thousands of pixels away from the user's cursor.
- **Impact**: Floating toolbar disorients the user by appearing at the top of the editor when selecting content further down the document.
- **Actionable Fix**:
  Resolve the rect from the focused selection point or return an empty rect so the toolbar suppresses display instead of jumping to the top:
  ```ts
  // src/components/nova/utils/getDOMRangeRect.ts
  export function getDOMRangeRect(
    nativeSelection: Selection,
    rootElement: HTMLElement,
  ): DOMRect {
    const { points, range } = getDOMSelectionRangeAndPoints(
      nativeSelection,
      rootElement,
    )
    if (range && points.anchorNode !== rootElement) {
      return range.getBoundingClientRect()
    }
    const focusNode = nativeSelection.focusNode
    if (focusNode) {
      const element =
        focusNode instanceof HTMLElement ? focusNode : focusNode.parentElement
      if (element && rootElement.contains(element)) {
        return element.getBoundingClientRect()
      }
    }
    return new DOMRect(0, 0, 0, 0)
  }
  ```

---

## 3. Medium Severity

### 3.1 Missing `CodeNode` Registration in `editorExtension` and Markdown Import

- **Files & Lines**:
  - [`src/components/nova/editor.ts#L17-L29`](file:///home/maddock/concept/src/components/nova/editor.ts#L17-L29)
  - [`src/lib/documents/import/index.ts#L29`](file:///home/maddock/concept/src/lib/documents/import/index.ts#L29)
  - [`src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.tsx#L85-L92`](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.tsx#L85-L92)
- **Root Cause**:
  1. `FloatingTextFormatToolbarPlugin.tsx` checks `$isCodeNode(node)` to suppress the toolbar inside code blocks.
  2. However, `editorExtension` in `src/components/nova/editor.ts` does not include `CodeExtension` or `CodeNode` in its dependencies.
  3. In `src/lib/documents/import/index.ts`, `createEditor` registers only `[HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode]`. When markdown containing code blocks (` ``` `) is imported, `convertMarkdown` filters out the code transformer (`editor.hasNodes(transformer.dependencies)` returns false), flattening code blocks into regular paragraphs.
- **Impact**: Code blocks in imported markdown files are stripped and degraded; code formatting options cannot be expanded.
- **Actionable Fix**:
  Register `CodeExtension` in `editor.ts` and add `CodeNode` / `CodeHighlightNode` to `convertImport`:
  ```ts
  // src/lib/documents/import/index.ts
  import { CodeNode, CodeHighlightNode } from '@lexical/code'
  // Add CodeNode, CodeHighlightNode to createEditor nodes array
  ```

---

### 3.2 Unbounded `requestAnimationFrame` Polling in `useFormatActions`

- **Status**: FIXED
- **Evidence & Validation**: Confirmed unbounded polling occurred when `editorRef.current` was null or delayed. Added retry counter capped at 60 animation frames before abandoning polling. Verified with unit test in `src/components/documents/navigation-menus/use-format-actions-polling.test.tsx` that RAF calls stop after 60 retries.
- **File & Line**: [`src/components/documents/navigation-menus/use-format-actions.ts#L138-L144`](file:///home/maddock/concept/src/components/documents/navigation-menus/use-format-actions.ts#L138-L144)
- **Root Cause**:
  ```tsx
  function connect() {
    const editor = editorRef.current
    if (!editor) {
      frame = requestAnimationFrame(connect)
      return
    }
  ```
  If `editorRef.current` is temporarily null or unmounted while `documentId` and `active` are true, `connect()` re-schedules itself on every animation frame continuously (60–120 times/sec) with no exit condition or backoff.
- **Impact**: High CPU and battery drain when a document route or component is loading or in an error state.
- **Actionable Fix**:
  Pass `editor` directly into the hook or cap retries before cancelling:
  ```tsx
  let retries = 0
  function connect() {
    const editor = editorRef.current
    if (!editor) {
      if (++retries < 60) {
        frame = requestAnimationFrame(connect)
      }
      return
    }
    // ...
  }
  ```

---

### 3.3 IME (Input Method Editor) Composition Collisions in Slash Menu

- **Files & Lines**:
  - [`src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L17-L21`](file:///home/maddock/concept/src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx#L17-L21)
  - [`src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.tsx#L53-L57`](file:///home/maddock/concept/src/components/nova/plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin.tsx#L53-L57)
- **Root Cause**:
  1. In `SlashMenuPlugin.tsx`, `useBasicTypeaheadTriggerMatch` is initialized with `allowWhitespace: true` and `minLength: 0`.
  2. `SlashMenuPlugin` does not check `editor.isComposing()`. When an international user types with IME (e.g. Japanese, Chinese, Korean), composition candidate confirmation keys (`Enter`, `Space`) trigger `KEY_ENTER_COMMAND` in `LexicalTypeaheadMenuPlugin`, inserting slash commands instead of confirming the composition string.
  3. In `FloatingTextFormatToolbarPlugin.tsx`, `editor.isComposing()` closes the toolbar, but the plugin does not listen for `COMPOSITION_END_COMMAND` to restore the toolbar once composition concludes.
- **Impact**: Accidental command insertion and broken text composition for international users.
- **Actionable Fix**:
  Guard trigger execution with `editor.isComposing()` and handle `COMPOSITION_END_COMMAND`:
  ```tsx
  // src/components/nova/plugins/SlashMenuPlugin/SlashMenuPlugin.tsx
  const trigger = useBasicTypeaheadTriggerMatch('/', {
    allowWhitespace: false,
    minLength: 1,
  })
  const triggerFunction = useCallback(
    (text: string, currentEditor: LexicalEditor) => {
      if (currentEditor.isComposing()) return null
      return trigger(text, currentEditor)
    },
    [trigger],
  )
  ```

---

### 3.4 Mobile Touch Incompatibility in `DragPlugin`

- **Status**: FIXED
- **Evidence & Validation**: Confirmed HTML5 drag-and-drop handles fail on touch devices and cause unwanted focus / keyboard loss. Added coarse pointer media query guard (`pointer: coarse`) to suppress DragPlugin on mobile/touch interfaces. Verified via unit test in `src/components/nova/plugins/DragPlugin/DragPlugin.test.tsx`.
- **File & Line**: [`src/components/nova/plugins/DragPlugin/DragPlugin.tsx#L10-L36`](file:///home/maddock/concept/src/components/nova/plugins/DragPlugin/DragPlugin.tsx#L10-L36)
- **Root Cause**:
  `DragPlugin` wraps `@lexical/react/LexicalDraggableBlockPlugin`, which relies exclusively on HTML5 Drag and Drop (`draggable="true"`, `dragstart`, `dragover`) and desktop `mousemove` / `mouseleave` events. Mobile browsers (iOS Safari and Android Chrome) do not support the HTML5 Drag and Drop API or mousemove emulation for drag handles.
- **Impact**: Drag handle appears on mobile or remains visible after tapping, but cannot drag or reorder blocks; touching it can trigger unwanted virtual keyboard blur or cursor jump.
- **Actionable Fix**:
  Detect touch capability and suppress the drag handle on primary touch devices:
  ```tsx
  // src/components/nova/plugins/DragPlugin/DragPlugin.tsx
  export function DragPlugin({ anchorElement }: DragPluginProps) {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches
    ) {
      return null
    }
    // ...
  }
  ```

---

## 4. Low Severity

### 4.1 Repeated DOM Allocation in `$decorateParagraph`

- **Status**: FIXED
- **Evidence & Validation**: Confirmed repeated `document.createElement('span')` was called during every decoration run. Implemented cached style resolution via `getSharedStyle(dom.ownerDocument)`. Verified via unit test in `src/components/nova/paragraph-format.test.ts` that elements are reused and not allocated repeatedly on paragraph decorations.
- **File & Line**: [`src/components/nova/paragraph-format.ts#L20-L28`](file:///home/maddock/concept/src/components/nova/paragraph-format.ts#L20-L28)
- **Root Cause**:
  ```ts
  function $decorateParagraph(node: LexicalNode, dom: HTMLElement) {
    if (!$isElementNode(node)) return
    const style = document.createElement('span').style
    style.cssText = $getParagraphStyle(node)
  ```
  `document.createElement('span')` is created on every decoration run of every paragraph during every DOM reconciliation. This creates garbage collection churn on rapid typing. Furthermore, direct reference to global `document` can fail in server-side or worker contexts.
- **Actionable Fix**:
  Reuse a module-level cached style object or parse style properties with string utilities:
  ```ts
  // src/components/nova/paragraph-format.ts
  const sharedStyle =
    typeof document !== 'undefined'
      ? document.createElement('span').style
      : null

  function $decorateParagraph(node: LexicalNode, dom: HTMLElement) {
    if (!$isElementNode(node) || !sharedStyle) return
    sharedStyle.cssText = $getParagraphStyle(node)
    for (const property of properties) {
      const value = sharedStyle.getPropertyValue(property)
      if (value) dom.style.setProperty(property, value)
      else dom.style.removeProperty(property)
    }
  }
  ```

---

### 4.2 Hardcoded LTR Placeholder in RTL Documents

- **Status**: FIXED
- **Evidence & Validation**: Confirmed physical `left` styling prevented proper RTL alignment. Replaced `left` with CSS logical property `insetInlineStart: marginX`. Added unit test in `src/components/nova/NovaContentEditable.test.tsx` verifying `insetInlineStart` style property on the placeholder element.
- **File & Line**: [`src/components/nova/NovaContentEditable.tsx#L16-L23`](file:///home/maddock/concept/src/components/nova/NovaContentEditable.tsx#L16-L23)
- **Root Cause**:
  The placeholder is hardcoded with `style={{ top: marginY, left: marginX }}`. When a document's direction is set to `rtl` (`format-options.ts` supports `direction: 'rtl'`), text starts on the right, but the placeholder remains pinned to the left edge.
- **Actionable Fix**:
  Use logical CSS properties (`inset-inline-start`) instead of physical `left`:
  ```tsx
  // src/components/nova/NovaContentEditable.tsx
  <span
    className="absolute text-muted-foreground italic pointer-events-none"
    style={{ top: marginY, insetInlineStart: marginX }}
  >
    {placeholderText}
  </span>
  ```

---

## Verification & Test Guidance

1. **Regex Crash Regression Test**: Add a unit test in `SlashMenuPlugin/options.test.ts` passing `/[`, `/*`, and `/(`, verifying that `SlashMenuPlugin` filters options cleanly without throwing `SyntaxError`.
2. **Selection Integrity Test**: Dispatch rapid formatting commands on split text nodes in `FloatingTextFormatToolbarPlugin.test.tsx` verifying no `Point.getNode: node not found` exceptions occur.
3. **IME Composition Test**: Simulate `compositionstart` -> typing -> `compositionend` over `/` trigger, ensuring slash menu does not intercept `Enter`.
