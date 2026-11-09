import { act } from 'react'
import { setupTestRoot } from '#/test/react-test'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  KEY_DOWN_COMMAND,
} from 'lexical'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEditActions } from './use-edit-actions'

const harness = setupTestRoot()
let editor: ReturnType<typeof createEditor>
let actions: ReturnType<typeof useEditActions>
const onError = vi.fn()
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
    onError: (error) => {
      throw error
    },
  })
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
  await act(async () => {
    editor.dispatchCommand(KEY_DOWN_COMMAND, event)
    await Promise.resolve()
  })
  expect(event.defaultPrevented).toBe(true)
  editor.getEditorState().read(() => {
    expect($getRoot().getAllTextNodes()[0].hasFormat('bold')).toBe(false)
  })
})
