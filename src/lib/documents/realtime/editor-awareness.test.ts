import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { Doc } from 'yjs'
import { attachEditorAwareness, selectionAwareness } from './editor-awareness'
import type { RealtimeProvider } from './realtime'

function makeProvider() {
  const awareness = new Awareness(new Doc())
  const provider = { awareness } as unknown as RealtimeProvider
  return { provider, awareness }
}

async function editorWithText(text: string): Promise<LexicalEditor> {
  const editor = createEditor()
  await editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(text))
      root.append(paragraph)
    },
    { discrete: true },
  )
  return editor
}

describe('selectionAwareness', () => {
  it('maps a text selection to global character offsets', async () => {
    const editor = await editorWithText('hello world')
    expect(
      editor.getEditorState().read(() => selectionAwareness(null)),
    ).toEqual({ presence: true, selection: null })

    await editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].select(6, 11)
      },
      { discrete: true },
    )
    const result = editor.getEditorState().read(() => {
      const selection = $getSelection()
      return selectionAwareness(
        selection && 'anchor' in selection ? (selection as never) : null,
      )
    })
    expect(result.selection).toEqual({ anchor: 6, focus: 11 })
  })
})

describe('attachEditorAwareness', () => {
  it('writes selection changes into the provider awareness and skips unchanged ones', async () => {
    const editor = await editorWithText('hello world')
    const { provider, awareness } = makeProvider()
    const getProvider = vi.fn(() => provider)
    const detach = attachEditorAwareness(editor, getProvider)
    const setLocalState = vi.spyOn(awareness, 'setLocalState')

    await editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].select(0, 5)
      },
      { discrete: true },
    )
    expect(setLocalState).toHaveBeenCalledTimes(1)
    expect(awareness.getLocalState()).toEqual({
      presence: true,
      selection: { anchor: 0, focus: 5 },
    })

    // Same selection again (e.g. remote update) must not re-broadcast.
    await editor.update(() => {}, { discrete: true })
    expect(setLocalState).toHaveBeenCalledTimes(1)

    detach()
    await editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].select(0, 8)
      },
      { discrete: true },
    )
    expect(setLocalState).toHaveBeenCalledTimes(1)
  })
})
