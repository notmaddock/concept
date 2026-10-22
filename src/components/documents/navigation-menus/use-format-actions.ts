import { useEffect, useState } from 'react'
import {
  $getParagraphStyle,
  $setParagraphStyle,
} from '#/components/nova/paragraph-format'
import type { RefObject } from 'react'
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  HISTORY_PUSH_TAG,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from 'lexical'
import type {
  EditorState,
  ElementNode,
  LexicalEditor,
  RangeSelection,
} from 'lexical'
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
} from '@lexical/rich-text'
import type { HeadingTagType } from '@lexical/rich-text'
import {
  $copyBlockFormatIndent,
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from '@lexical/selection'
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list'
import type { FormatAction } from './format-options'

function $blocks(selection: RangeSelection): ElementNode[] {
  const blocks = new Map<string, ElementNode>()
  for (const node of [...selection.getNodes(), selection.anchor.getNode()]) {
    let element = $isElementNode(node) ? node : node.getParent()
    while (element?.isInline()) element = element.getParent()
    if (element && element.getType() !== 'root' && !$isListNode(element))
      blocks.set(element.getKey(), element)
  }
  return [...blocks.values()]
}

export function $applyFormatAction(action: FormatAction) {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return
  if (action.kind === 'text') selection.formatText(action.value)
  else if (action.kind === 'style')
    $patchStyleText(selection, { [action.property]: action.value || null })
  else if (action.kind === 'block')
    $setBlocksType(
      selection,
      () =>
        action.value === 'paragraph'
          ? $createParagraphNode()
          : action.value === 'quote'
            ? $createQuoteNode()
            : $createHeadingNode(action.value as HeadingTagType),
      (previous, next) => {
        $copyBlockFormatIndent(previous, next)
        next.setDirection(previous.getDirection())
        $setParagraphStyle(next, $getParagraphStyle(previous))
      },
    )
  else if (action.kind === 'direction')
    $blocks(selection).forEach((node) => node.setDirection(action.value))
  else if (action.kind === 'paragraph')
    $blocks(selection).forEach((node) => {
      const style = document.createElement('span').style
      style.cssText = $getParagraphStyle(node)
      style.setProperty(action.property, action.value)
      $setParagraphStyle(node, style.cssText)
    })
  else if (action.kind === 'clear' && action.value === 'text') {
    selection.extract().forEach((node) => {
      if ($isTextNode(node)) node.setFormat(0).setStyle('')
    })
    selection.format = 0
    selection.style = ''
  } else if (action.kind === 'clear')
    $blocks(selection).forEach((node) => {
      $setParagraphStyle(node, '')
      node.setFormat('').setIndent(0).setDirection(null)
    })
}

interface SelectionSummary {
  selection: RangeSelection
  blocks: ElementNode[]
  styles: Map<string, string>
  paragraphStyles: Map<string, CSSStyleDeclaration>
  lists: Map<string, string | null>
}

const selectionSummaries = new WeakMap<EditorState, SelectionSummary>()

function $selectionSummary(
  editorState: EditorState,
  selection: RangeSelection,
) {
  let summary = selectionSummaries.get(editorState)
  if (!summary) {
    summary = {
      selection,
      blocks: $blocks(selection),
      styles: new Map(),
      paragraphStyles: new Map(),
      lists: new Map(),
    }
    selectionSummaries.set(editorState, summary)
  }
  return summary
}

function $checked(
  action: FormatAction,
  summary: SelectionSummary,
): boolean | undefined {
  const { selection, blocks, styles, paragraphStyles, lists } = summary
  if (action.kind === 'text') return selection.hasFormat(action.value)
  if (action.kind === 'style') {
    if (!styles.has(action.property))
      styles.set(
        action.property,
        $getSelectionStyleValueForProperty(selection, action.property, ''),
      )
    return styles.get(action.property) === action.value
  }
  if (!blocks.length) return false
  if (action.kind === 'block')
    return blocks.every((node) =>
      $isHeadingNode(node)
        ? node.getTag() === action.value
        : node.getType() === action.value,
    )
  if (action.kind === 'align')
    return blocks.every(
      (node) => (node.getFormatType() || 'left') === action.value,
    )
  if (action.kind === 'direction')
    return blocks.every(
      (node) => (node.getDirection() || 'ltr') === action.value,
    )
  if (action.kind === 'paragraph')
    return blocks.every((node) => {
      const key = node.getKey()
      let style = paragraphStyles.get(key)
      if (!style) {
        style = document.createElement('span').style
        style.cssText = $getParagraphStyle(node)
        paragraphStyles.set(key, style)
      }
      return style.getPropertyValue(action.property) === action.value
    })
  if (action.kind === 'list')
    return blocks.every((node) => {
      const key = node.getKey()
      if (!lists.has(key)) {
        let parent = node.getParent()
        while (parent && !$isListNode(parent)) parent = parent.getParent()
        lists.set(key, $isListNode(parent) ? parent.getListType() : null)
      }
      const list = lists.get(key)
      return action.value === 'none' ? list === null : list === action.value
    })
  return undefined
}

export function useFormatActions(
  editorRef: RefObject<LexicalEditor | null>,
  documentId: string | undefined,
  actions: FormatAction[],
  active = true,
) {
  const [state, setState] = useState<{
    enabled: boolean
    checked: (boolean | undefined)[]
  }>({ enabled: false, checked: [] })
  useEffect(() => {
    let frame = 0
    let cleanup = () => {}
    setState({ enabled: false, checked: [] })
    function connect() {
      const editor = editorRef.current
      if (!editor) {
        frame = requestAnimationFrame(connect)
        return
      }
      const update = () => {
        const editorState = editor.getEditorState()
        editorState.read(() => {
          const selection = $getSelection()
          const enabled = editor.isEditable() && $isRangeSelection(selection)
          const summary = $isRangeSelection(selection)
            ? $selectionSummary(editorState, selection)
            : null
          const checked = summary
            ? actions.map((action) => $checked(action, summary))
            : []
          setState((current) =>
            current.enabled === enabled &&
            current.checked.length === checked.length &&
            current.checked.every((value, index) => value === checked[index])
              ? current
              : { enabled, checked },
          )
        })
      }
      update()
      const unregisterUpdate = editor.registerUpdateListener(update)
      const unregisterEditable = editor.registerEditableListener(update)
      cleanup = () => {
        unregisterUpdate()
        unregisterEditable()
      }
    }
    if (documentId && active) connect()
    return () => {
      cancelAnimationFrame(frame)
      cleanup()
    }
  }, [editorRef, documentId, actions, active])

  async function run(action: FormatAction) {
    const editor = editorRef.current
    if (!editor || !state.enabled) return
    const selection = editor
      .getEditorState()
      .read(() => $getSelection()?.clone())
    await Promise.resolve()
    // Focus before committing: restoring the DOM selection can synchronously fire focus events.
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.update(
      () => {
        if (selection) $setSelection(selection)
        if (action.kind === 'align')
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, action.value)
        else if (action.kind === 'indent')
          editor.dispatchCommand(
            action.value === 'increase'
              ? INDENT_CONTENT_COMMAND
              : OUTDENT_CONTENT_COMMAND,
            undefined,
          )
        else if (action.kind === 'list')
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
        else if (action.kind === 'text')
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, action.value)
        else $applyFormatAction(action)
      },
      { tag: HISTORY_PUSH_TAG },
    )
    editor.focus()
  }
  return {
    run,
    disabled: !state.enabled,
    checked: (action: FormatAction) => state.checked[actions.indexOf(action)],
  }
}
