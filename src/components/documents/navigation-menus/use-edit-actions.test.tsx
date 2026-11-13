import { act } from 'react'
import { setupTestRoot } from '#/test/react-test'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  REDO_COMMAND,
  UNDO_COMMAND,
  createEditor,
  KEY_DOWN_COMMAND,
} from 'lexical'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEditActions } from './use-edit-actions'
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text'
import {
  ListItemNode,
  ListNode,
  registerCheckList,
  registerList,
} from '@lexical/list'
import { CodeNode } from '@lexical/code'
import {
  editorShortcuts,
  getEditorActionShortcut,
  matchEditorShortcut,
  registerEditorShortcuts,
} from '#/components/nova/editor-shortcuts'
import { OPEN_LINK_DIALOG_COMMAND } from '#/components/nova/plugins/LinkPlugin/commands'

const harness = setupTestRoot()
let editor: ReturnType<typeof createEditor>
let actions: ReturnType<typeof useEditActions>
const onError = vi.fn()
let editorRoot: HTMLDivElement
let cleanups: (() => void)[]
const editorRef: { current: ReturnType<typeof createEditor> | null } = {
  current: null,
}

function Harness() {
  actions = useEditActions(editorRef, 'document', onError)
  return null
}

beforeEach(async () => {
  editor = createEditor({
    namespace: 'edit-test',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode],
    onError: (error) => {
      throw error
    },
  })
  editorRoot = document.createElement('div')
  document.body.append(editorRoot)
  editor.setRootElement(editorRoot)
  cleanups = [
    registerRichText(editor),
    registerList(editor),
    registerEditorShortcuts(editor, false),
  ]
  editorRef.current = editor
  editor.update(
    () => {
      const text = $createTextNode('hello world').setFormat('bold')
      $getRoot().append($createParagraphNode().append(text))
      text.select(0, 5)
    },
    { discrete: true },
  )
  await act(() => harness.root.render(<Harness />))
})

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup())
  editor.setRootElement(null)
  editorRoot.remove()
  onError.mockReset()
})

it('clears formatting only from the selected text', async () => {
  await act(async () => {
    await actions.run('clear-formatting')
    await Promise.resolve()
  })
  editor.getEditorState().read(() => {
    const nodes = $getRoot().getAllTextNodes()
    expect(
      nodes.map((node) => [node.getTextContent(), node.hasFormat('bold')]),
    ).toEqual([
      ['hello', false],
      [' world', true],
    ])
  })
})

it('selects the whole document and deletes the selection', async () => {
  await act(async () => {
    await actions.run('select-all')
    await Promise.resolve()
  })
  editor.getEditorState().read(() => {
    expect($getSelection()?.getTextContent()).toBe('hello world')
  })
  await act(async () => {
    await actions.run('delete-selection')
    await Promise.resolve()
  })
  editor
    .getEditorState()
    .read(() => expect($getRoot().getTextContent()).toBe(''))
  expect(actions.disabled('delete-selection')).toBe(true)
})

it('pastes plain text without inheriting formatting', async () => {
  vi.stubGlobal(
    'DataTransfer',
    class {
      data = new Map<string, string>()
      setData(type: string, value: string) {
        this.data.set(type, value)
      }
      getData(type: string) {
        return this.data.get(type) ?? ''
      }
    },
  )
  vi.stubGlobal('navigator', {
    platform: 'Linux',
    clipboard: { readText: async () => 'pasted' },
  })
  await act(async () => {
    await actions.run('paste-plain')
    await Promise.resolve()
  })
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('pasted world')
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.format).toBe(0)
  })
})

it('preserves text and reports denied clipboard access', async () => {
  vi.stubGlobal('navigator', {
    platform: 'Linux',
    clipboard: {
      read: async () => {
        throw new Error('denied')
      },
    },
  })
  await act(async () => {
    await actions.run('paste')
    await Promise.resolve()
  })
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Ctrl+V'))
  editor
    .getEditorState()
    .read(() => expect($getRoot().getTextContent()).toBe('hello world'))
})

it('clears formatting with the displayed keyboard shortcut', async () => {
  const event = new KeyboardEvent('keydown', {
    key: '\\',
    ctrlKey: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'target', { value: editorRoot })
  await act(async () => {
    editor.dispatchCommand(KEY_DOWN_COMMAND, event)
    await Promise.resolve()
  })
  expect(event.defaultPrevented).toBe(true)
  editor.getEditorState().read(() => {
    expect($getRoot().getAllTextNodes()[0].hasFormat('bold')).toBe(false)
  })
})

async function press(init: KeyboardEventInit, target: Node = editorRoot) {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  await act(async () => {
    editor.dispatchCommand(KEY_DOWN_COMMAND, event)
    await Promise.resolve()
  })
  return event
}

it.each([1, 2, 3, 4, 5, 6])(
  'sets heading %s from Ctrl+Alt+digit',
  async (level) => {
    const event = await press({
      key: String(level),
      code: `Digit${level}`,
      ctrlKey: true,
      altKey: true,
    })
    expect(event.defaultPrevented).toBe(true)
    editor.getEditorState().read(() => {
      const block = $getRoot().getFirstChild()
      expect(block).toBeInstanceOf(HeadingNode)
      expect((block as HeadingNode).getTag()).toBe(`h${level}`)
    })
  },
)

it('restores normal paragraphs and executes quote, code, lists and alignment', async () => {
  await press({ key: '1', ctrlKey: true, altKey: true })
  await press({ key: '0', ctrlKey: true, altKey: true })
  editor
    .getEditorState()
    .read(() => expect($getRoot().getFirstChild()?.getType()).toBe('paragraph'))
  await press({ key: '(', code: 'Digit9', ctrlKey: true, shiftKey: true })
  editor
    .getEditorState()
    .read(() => expect($getRoot().getFirstChild()).toBeInstanceOf(QuoteNode))
  await press({
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  })
  editor
    .getEditorState()
    .read(() => expect($getRoot().getFirstChild()).toBeInstanceOf(CodeNode))
  await press({ key: '0', ctrlKey: true, altKey: true })
  await press({ key: '&', code: 'Digit7', ctrlKey: true, shiftKey: true })
  editor.getEditorState().read(() => {
    expect(($getRoot().getFirstChild() as ListNode).getListType()).toBe(
      'number',
    )
  })
  await press({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true })
  editor.getEditorState().read(() => {
    expect(($getRoot().getFirstChild() as ListNode).getListType()).toBe(
      'bullet',
    )
  })
  await press({ key: 'E', ctrlKey: true, shiftKey: true })
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    const parent = $isRangeSelection(selection)
      ? selection.anchor.getNode().getParent()
      : null
    expect($isElementNode(parent) && parent.getFormatType()).toBe('center')
  })
})

it.each([
  ['i', false, 'italic'],
  ['u', false, 'underline'],
  ['X', true, 'strikethrough'],
  ['e', false, 'code'],
  [',', false, 'subscript'],
  ['.', false, 'superscript'],
] as const)('runs text formatting for %s', async (key, shiftKey, format) => {
  const event = await press({ key, shiftKey, ctrlKey: true })
  expect(event.defaultPrevented).toBe(true)
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.hasFormat(format)).toBe(
      true,
    )
  })
})

it('routes links once and leaves browser shortcuts and unhandled commands alone', async () => {
  const open = vi.fn(() => true)
  cleanups.push(
    editor.registerCommand(
      OPEN_LINK_DIALOG_COMMAND,
      open,
      COMMAND_PRIORITY_EDITOR,
    ),
  )
  expect((await press({ key: 'k', ctrlKey: true })).defaultPrevented).toBe(true)
  expect(open).toHaveBeenCalledOnce()
  for (const key of ['c', 'x', 'v', 'f', 'p', 'l', 'r']) {
    expect((await press({ key, ctrlKey: true })).defaultPrevented).toBe(false)
  }
  // No checklist command is registered in this fixture.
  expect(
    (await press({ key: '9', ctrlKey: true, altKey: true, shiftKey: true }))
      .defaultPrevented,
  ).toBe(false)
})

it('only consumes history shortcuts when the corresponding action is available', async () => {
  const undo = vi.fn(() => true)
  const redo = vi.fn(() => true)
  cleanups.push(
    editor.registerCommand(UNDO_COMMAND, undo, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(REDO_COMMAND, redo, COMMAND_PRIORITY_EDITOR),
  )
  const redoBindings = [
    { key: 'y', ctrlKey: true },
    { key: 'Z', ctrlKey: true, shiftKey: true },
  ]
  expect((await press({ key: 'z', ctrlKey: true })).defaultPrevented).toBe(
    false,
  )
  for (const binding of redoBindings) {
    expect((await press(binding)).defaultPrevented).toBe(false)
  }
  expect(undo).not.toHaveBeenCalled()
  expect(redo).not.toHaveBeenCalled()

  await act(() => {
    editor.dispatchCommand(CAN_UNDO_COMMAND, true)
  })
  expect((await press({ key: 'z', ctrlKey: true })).defaultPrevented).toBe(true)
  for (const binding of redoBindings) {
    expect((await press(binding)).defaultPrevented).toBe(false)
  }
  expect(undo).toHaveBeenCalledOnce()
  expect(redo).not.toHaveBeenCalled()

  await act(() => {
    editor.dispatchCommand(CAN_UNDO_COMMAND, false)
    editor.dispatchCommand(CAN_REDO_COMMAND, true)
  })
  expect((await press({ key: 'z', ctrlKey: true })).defaultPrevented).toBe(
    false,
  )
  for (const binding of redoBindings) {
    expect((await press(binding)).defaultPrevented).toBe(true)
  }
  expect(undo).toHaveBeenCalledOnce()
  expect(redo).toHaveBeenCalledTimes(2)

  await act(() => {
    editor.dispatchCommand(CAN_REDO_COMMAND, false)
  })
  for (const binding of redoBindings) {
    expect((await press(binding)).defaultPrevented).toBe(false)
  }
  expect(redo).toHaveBeenCalledTimes(2)
})

it('does not retry unhandled history commands through the Lexical keyboard fallback', async () => {
  const undo = vi.fn(() => false)
  const redo = vi.fn(() => false)
  cleanups.push(
    editor.registerCommand(UNDO_COMMAND, undo, COMMAND_PRIORITY_EDITOR),
    editor.registerCommand(REDO_COMMAND, redo, COMMAND_PRIORITY_EDITOR),
  )
  await act(() => {
    editor.dispatchCommand(CAN_UNDO_COMMAND, true)
    editor.dispatchCommand(CAN_REDO_COMMAND, true)
  })
  for (const binding of [
    { key: 'z', ctrlKey: true },
    { key: 'y', ctrlKey: true },
    { key: 'Z', ctrlKey: true, shiftKey: true },
  ]) {
    expect((await press(binding)).defaultPrevented).toBe(false)
  }
  expect(undo).toHaveBeenCalledOnce()
  expect(redo).toHaveBeenCalledTimes(2)
})

it('ignores unrelated inputs, read-only editing, composition and missing selections', async () => {
  const outside = document.createElement('input')
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true }, outside))
      .defaultPrevented,
  ).toBe(false)
  const input = document.createElement('input')
  editorRoot.append(input)
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true }, input))
      .defaultPrevented,
  ).toBe(false)
  input.remove()
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true, isComposing: true }))
      .defaultPrevented,
  ).toBe(false)
  editor.setEditable(false)
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true })).defaultPrevented,
  ).toBe(false)
  expect((await press({ key: 'a', ctrlKey: true })).defaultPrevented).toBe(true)
  editor.setEditable(true)
  editor.update(() => $setSelection(null), { discrete: true })
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true })).defaultPrevented,
  ).toBe(false)
})

it('matches platform modifiers exactly and handles shifted and Option-modified keys', () => {
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', {
        key: '¡',
        code: 'Digit1',
        metaKey: true,
        altKey: true,
      }),
      true,
    )?.id,
  ).toBe('format-h1')
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', {
        key: 'Ç',
        code: 'KeyC',
        metaKey: true,
        altKey: true,
        shiftKey: true,
      }),
      true,
    )?.id,
  ).toBe('insert-code-block')
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }),
      true,
    ),
  ).toBeUndefined()
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true }),
      false,
    ),
  ).toBeUndefined()
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, altKey: true }),
      false,
    ),
  ).toBeUndefined()
  expect(
    matchEditorShortcut(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }),
      false,
    ),
  ).toBeUndefined()
  const altGraph = new KeyboardEvent('keydown', {
    key: '1',
    ctrlKey: true,
    altKey: true,
  })
  vi.spyOn(altGraph, 'getModifierState').mockImplementation(
    (key) => key === 'AltGraph',
  )
  expect(matchEditorShortcut(altGraph, false)).toBeUndefined()
  const prevented = new KeyboardEvent('keydown', {
    key: 'b',
    ctrlKey: true,
    cancelable: true,
  })
  prevented.preventDefault()
  expect(matchEditorShortcut(prevented, false)).toBeUndefined()
})

it('keeps menu labels and executable bindings in the same registry', () => {
  expect(getEditorActionShortcut('format-h6')).toEqual({
    keys: ['Ctrl', 'Alt', '6'],
    macKeys: ['⌘', 'Option', '6'],
  })
  expect(getEditorActionShortcut('format-clear-text')).toEqual(
    getEditorActionShortcut('clear-formatting'),
  )
  for (const shortcut of editorShortcuts) {
    expect(getEditorActionShortcut(shortcut.id)?.keys.length).toBeGreaterThan(0)
  }
})

it('executes checklists when their existing command handler is registered', async () => {
  cleanups.push(registerCheckList(editor))
  const event = await press({
    key: '9',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  })
  expect(event.defaultPrevented).toBe(true)
  editor.getEditorState().read(() => {
    expect(($getRoot().getFirstChild() as ListNode).getListType()).toBe('check')
  })
})

it('does not consume clear-formatting for a collapsed selection or editor composition', async () => {
  editor.update(
    () => {
      $getRoot().getAllTextNodes()[0].select(0, 0)
    },
    { discrete: true },
  )
  expect((await press({ key: '\\', ctrlKey: true })).defaultPrevented).toBe(
    false,
  )
  const composing = vi.spyOn(editor, 'isComposing').mockReturnValue(true)
  expect(
    (await press({ key: '1', ctrlKey: true, altKey: true })).defaultPrevented,
  ).toBe(false)
  composing.mockRestore()
})
