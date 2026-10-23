import { act } from 'react'
import { Toaster, toast } from 'sonner'
import { createRoot } from 'react-dom/client'
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

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
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
  await act(async () => root.render(<Harness />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  onError.mockReset()
  vi.unstubAllGlobals()
})

it('clears formatting only from the selected text', async () => {
  await act(async () => actions.run('clear-formatting'))
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
  await act(async () => actions.run('select-all'))
  editor.getEditorState().read(() => {
    expect($getSelection()?.getTextContent()).toBe('hello world')
  })
  await act(async () => actions.run('delete-selection'))
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
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux')
  vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('pasted')
  await act(async () => actions.run('paste-plain'))
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('pasted world')
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.format).toBe(0)
  })
})

it('preserves text and reports denied clipboard access', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux')
  vi.spyOn(navigator.clipboard, 'read').mockRejectedValue(new Error('denied'))
  await act(async () => actions.run('paste'))
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
  })
  expect(event.defaultPrevented).toBe(true)
  editor.getEditorState().read(() => {
    expect($getRoot().getAllTextNodes()[0].hasFormat('bold')).toBe(false)
  })
})

it('leaves the bold shortcut available to the editor', async () => {
  const event = new KeyboardEvent('keydown', {
    key: 'b',
    ctrlKey: true,
    cancelable: true,
  })
  await act(async () => {
    editor.dispatchCommand(KEY_DOWN_COMMAND, event)
  })
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.hasFormat('bold')).toBe(
      false,
    )
  })
})

it('shows clipboard failures as Sonner toasts', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  onError.mockImplementation((message: string) => {
    toast.error(message)
  })
  await act(async () =>
    root.render(
      <>
        <Harness />
        <Toaster theme="light" />
      </>,
    ),
  )
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux')
  vi.spyOn(navigator.clipboard, 'read').mockRejectedValue(new Error('denied'))
  await act(async () => {
    await actions.run('paste')
    await vi.advanceTimersByTimeAsync(20)
  })
  expect(
    container.querySelector('[data-sonner-toast][data-type="error"]')
      ?.textContent,
  ).toContain(
    'Could not access the clipboard. Use Ctrl+V in the editor instead.',
  )
  toast.dismiss()
})

it('does not paste into a closed document after clipboard permission resolves', async () => {
  let complete!: (text: string) => void
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
  vi.spyOn(navigator.clipboard, 'readText').mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve
      }),
  )
  let paste!: Promise<void>
  await act(async () => {
    paste = actions.run('paste-plain')
    await Promise.resolve()
  })
  editorRef.current = createEditor()
  await act(async () => {
    complete('pasted into stale editor')
    await paste
  })
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('hello world')
  })
  expect(onError).not.toHaveBeenCalled()
})
