import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  $selectAll,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  getNearestEditorFromDOMNode,
  HISTORY_PUSH_TAG,
  INDENT_CONTENT_COMMAND,
  KEY_DOWN_COMMAND,
  mergeRegister,
  REDO_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  UNDO_COMMAND,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list'
import type { ActionShortcut } from '#/components/documents/navigation-menus/document-navigation-options'
import type { FormatAction } from '#/components/documents/navigation-menus/format-options'
import {
  $applyFormatAction,
  $clearSelectionFormatting,
} from '#/components/documents/navigation-menus/use-format-actions'
import { isMac } from '#/components/documents/navigation-menus/ActionShortcut'
import { $insertCodeBlock } from './plugins/CodePlugin/commands'
import { OPEN_LINK_DIALOG_COMMAND } from './plugins/LinkPlugin/commands'
import { INSERT_PAGE_BREAK } from './pages/PageBreakExtension'

type Binding = {
  key: string
  shift?: boolean
  alt?: boolean
  primary?: boolean
  platform?: 'mac' | 'other'
}

type ShortcutDefinition = {
  id: string
  label: string
  group: 'Editing' | 'Text formatting' | 'Paragraphs and blocks' | 'Alignment'
  bindings: Binding[]
  format?: FormatAction
  native?: boolean
}

const primary = (key: string, modifiers: Partial<Binding> = {}): Binding => ({
  key,
  primary: true,
  ...modifiers,
})

export const editorShortcuts: ShortcutDefinition[] = [
  { id: 'undo', label: 'Undo', group: 'Editing', bindings: [primary('z')] },
  {
    id: 'redo',
    label: 'Redo',
    group: 'Editing',
    bindings: [
      primary('y', { platform: 'other' }),
      primary('z', { shift: true }),
    ],
  },
  ...[
    ['cut', 'Cut', 'x'],
    ['copy', 'Copy', 'c'],
    ['paste', 'Paste', 'v'],
    ['find', 'Find in page (browser)', 'f'],
    ['search-actions', 'Search menus and actions', '/'],
    ['print', 'Print', 'p'],
  ].map(([id, label, key]): ShortcutDefinition => ({
    id,
    label,
    group: 'Editing',
    bindings: [primary(key)],
    native: true,
  })),
  {
    id: 'paste-plain',
    label: 'Paste without formatting',
    group: 'Editing',
    bindings: [primary('v', { shift: true })],
    native: true,
  },
  {
    id: 'select-all',
    label: 'Select all',
    group: 'Editing',
    bindings: [primary('a')],
  },
  {
    id: 'delete-selection',
    label: 'Delete selection',
    group: 'Editing',
    bindings: [
      { key: 'Delete', platform: 'other' },
      { key: 'Backspace', platform: 'mac' },
    ],
    native: true,
  },
  {
    id: 'clear-formatting',
    label: 'Clear text formatting',
    group: 'Text formatting',
    bindings: [primary('\\')],
  },
  ...(
    [
      ['bold', 'Bold', 'b', false],
      ['italic', 'Italic', 'i', false],
      ['underline', 'Underline', 'u', false],
      ['strikethrough', 'Strikethrough', 'x', true],
      ['code', 'Inline code', 'e', false],
      ['subscript', 'Subscript', ',', false],
      ['superscript', 'Superscript', '.', false],
    ] as const
  ).map(([value, label, key, shift]): ShortcutDefinition => ({
    id: `format-${value}`,
    label,
    group: 'Text formatting',
    bindings: [primary(key, { shift })],
    format: { kind: 'text', value },
  })),
  {
    id: 'insert-link',
    label: 'Insert or edit link',
    group: 'Text formatting',
    bindings: [primary('k')],
  },
  ...['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(
    (value, index): ShortcutDefinition => ({
      id: `format-${value}`,
      label: index === 0 ? 'Normal text' : `Heading ${index}`,
      group: 'Paragraphs and blocks',
      bindings: [primary(String(index), { alt: true })],
      format: { kind: 'block', value },
    }),
  ),
  ...(
    [
      ['number', 'Numbered list', '7', false],
      ['bullet', 'Bulleted list', '8', false],
      ['check', 'Checklist', '9', true],
    ] as const
  ).map(([value, label, key, alt]): ShortcutDefinition => ({
    id: `format-list-${value}`,
    label,
    group: 'Paragraphs and blocks',
    bindings: [primary(key, { shift: true, alt })],
    format: { kind: 'list', value },
  })),
  {
    id: 'format-quote',
    label: 'Block quote',
    group: 'Paragraphs and blocks',
    bindings: [primary('9', { shift: true })],
    format: { kind: 'block', value: 'quote' },
  },
  {
    id: 'insert-code-block',
    label: 'Code block',
    group: 'Paragraphs and blocks',
    // The extra Shift avoids browser developer-tools shortcuts on macOS.
    bindings: [primary('c', { alt: true, shift: true })],
  },
  {
    id: 'insert-page-break',
    label: 'Page break',
    group: 'Paragraphs and blocks',
    bindings: [primary('Enter')],
  },
  ...(['increase', 'decrease'] as const).map((value): ShortcutDefinition => ({
    id: `format-indent-${value}`,
    label: value === 'increase' ? 'Increase indent' : 'Decrease indent',
    group: 'Paragraphs and blocks',
    bindings: [primary(value === 'increase' ? ']' : '[')],
    format: { kind: 'indent', value },
  })),
  ...(
    [
      ['left', 'Align left', 'l'],
      ['center', 'Align center', 'e'],
      ['right', 'Align right', 'r'],
      ['justify', 'Justify', 'j'],
    ] as const
  ).map(([value, label, key]): ShortcutDefinition => ({
    id: `format-align-${value}`,
    label,
    group: 'Alignment',
    bindings: [primary(key, { shift: true })],
    format: { kind: 'align', value },
  })),
]

function platformBindings(shortcut: ShortcutDefinition, mac: boolean) {
  return shortcut.bindings.filter(
    (binding) =>
      !binding.platform || binding.platform === (mac ? 'mac' : 'other'),
  )
}

function bindingKeys(binding: Binding, mac: boolean) {
  return [
    ...(binding.primary ? [mac ? '⌘' : 'Ctrl'] : []),
    ...(binding.alt ? [mac ? 'Option' : 'Alt'] : []),
    ...(binding.shift ? ['Shift'] : []),
    binding.key === 'Backspace'
      ? '⌫'
      : binding.key.length === 1
        ? binding.key.toUpperCase()
        : binding.key,
  ]
}

export function getEditorActionShortcut(
  id: string,
): ActionShortcut | undefined {
  const shortcut = editorShortcuts.find(
    (entry) =>
      entry.id === (id === 'format-clear-text' ? 'clear-formatting' : id),
  )
  if (!shortcut) return undefined
  return {
    keys: bindingKeys(platformBindings(shortcut, false)[0], false),
    macKeys: bindingKeys(platformBindings(shortcut, true)[0], true),
  }
}

export function getEditorShortcutLabels(
  shortcut: ShortcutDefinition,
  mac: boolean,
) {
  return platformBindings(shortcut, mac).map((binding) =>
    bindingKeys(binding, mac),
  )
}

export function matchEditorShortcut(event: KeyboardEvent, mac: boolean) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState('AltGraph') ||
    event.key === 'Dead' ||
    event.key === 'Process'
  )
    return undefined
  return editorShortcuts.find((shortcut) =>
    shortcut.bindings.some((binding) => {
      if (
        (binding.platform && binding.platform !== (mac ? 'mac' : 'other')) ||
        event.ctrlKey !== Boolean(binding.primary && !mac) ||
        event.metaKey !== Boolean(binding.primary && mac) ||
        event.altKey !== Boolean(binding.alt) ||
        event.shiftKey !== Boolean(binding.shift)
      )
        return false
      // Shift and Option change printable keys; match those chords by position.
      if (/^\d$/.test(binding.key) && event.code) {
        return event.code === `Digit${binding.key}`
      }
      if (binding.alt && /^[a-z]$/i.test(binding.key) && event.code) {
        return event.code === `Key${binding.key.toUpperCase()}`
      }
      return event.key.toLowerCase() === binding.key.toLowerCase()
    }),
  )
}

function $executeShortcut(editor: LexicalEditor, shortcut: ShortcutDefinition) {
  if (shortcut.id === 'select-all') {
    $selectAll()
    return true
  }
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  if (shortcut.id === 'insert-link') {
    return editor.dispatchCommand(OPEN_LINK_DIALOG_COMMAND, undefined)
  }
  if (shortcut.id === 'insert-page-break') {
    return editor.dispatchCommand(INSERT_PAGE_BREAK, undefined)
  }
  if (shortcut.id === 'clear-formatting' && selection.isCollapsed())
    return false
  if (shortcut.format?.kind === 'text') {
    return editor.dispatchCommand(FORMAT_TEXT_COMMAND, shortcut.format.value)
  }
  if (shortcut.format?.kind === 'align') {
    return editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, shortcut.format.value)
  }
  if (shortcut.format?.kind === 'list') {
    const command =
      shortcut.format.value === 'bullet'
        ? INSERT_UNORDERED_LIST_COMMAND
        : shortcut.format.value === 'number'
          ? INSERT_ORDERED_LIST_COMMAND
          : INSERT_CHECK_LIST_COMMAND
    return editor.dispatchCommand(command, undefined)
  }
  if (shortcut.format?.kind === 'indent') {
    return editor.dispatchCommand(
      shortcut.format.value === 'increase'
        ? INDENT_CONTENT_COMMAND
        : OUTDENT_CONTENT_COMMAND,
      undefined,
    )
  }
  $addUpdateTag(HISTORY_PUSH_TAG)
  if (shortcut.id === 'clear-formatting') $clearSelectionFormatting()
  else if (shortcut.id === 'insert-code-block') $insertCodeBlock()
  else if (shortcut.format) $applyFormatAction(shortcut.format)
  else return false
  return true
}

export function registerEditorShortcuts(editor: LexicalEditor, mac = isMac()) {
  let canUndo = false
  let canRedo = false
  return mergeRegister(
    editor.registerCommand(
      CAN_UNDO_COMMAND,
      (value) => {
        canUndo = value
        return false
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      CAN_REDO_COMMAND,
      (value) => {
        canRedo = value
        return false
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        const root = editor.getRootElement()
        const target = event.target
        if (
          editor.isComposing() ||
          !root ||
          !(target instanceof Node) ||
          !root.contains(target) ||
          getNearestEditorFromDOMNode(target) !== editor ||
          (target instanceof Element &&
            target.closest(
              'input, textarea, select, [contenteditable="false"]',
            ))
        )
          return false
        const shortcut = matchEditorShortcut(event, mac)
        if (
          !shortcut ||
          shortcut.native ||
          (!editor.isEditable() && shortcut.id !== 'select-all')
        )
          return false
        if (shortcut.id === 'undo' || shortcut.id === 'redo') {
          if (
            (shortcut.id === 'undo' ? canUndo : canRedo) &&
            editor.dispatchCommand(
              shortcut.id === 'undo' ? UNDO_COMMAND : REDO_COMMAND,
              undefined,
            )
          )
            event.preventDefault()
          // Own the chord even when unavailable: Lexical's lower-priority
          // keyboard fallback prevents default and dispatches history blindly.
          return true
        }
        const handled = $executeShortcut(editor, shortcut)
        if (handled) event.preventDefault()
        return handled
      },
      COMMAND_PRIORITY_HIGH,
    ),
  )
}

export function EditorShortcutsPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => registerEditorShortcuts(editor), [editor])
  return null
}
