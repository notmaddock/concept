import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $createImageNode } from './nodes/ImageNode'
import type { AssetId } from '#/lib/documents/assets'
import { Nova } from './Nova'

vi.mock('./plugins/DragPlugin/DragPlugin', () => ({
  DragPlugin: () => <div data-testid="drag-plugin" />,
}))

vi.mock('./plugins/SlashMenuPlugin/SlashMenuPlugin', () => ({
  SlashMenuPlugin: () => <div data-testid="slash-menu-plugin" />,
}))

vi.mock(
  './plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin',
  () => ({
    FloatingTextFormatToolbarPlugin: () => (
      <div data-testid="floating-format-toolbar-plugin" />
    ),
  }),
)

describe('Nova editor mode and read-only behavior', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(() => root.unmount())
    container.remove()
  })

  it('configures editor as editable and mounts mutation plugins in edit mode', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="edit" />)
    })

    expect(editorRef.current?.isEditable()).toBe(true)
    expect(
      container.querySelector('[data-testid="drag-plugin"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="slash-menu-plugin"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="floating-format-toolbar-plugin"]'),
    ).not.toBeNull()
  })

  it('triple-clicks a text block without including the image below it', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => root.render(<Nova editorRef={editorRef} />))
    const editor = editorRef.current!
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode('Entire text block'),
              ),
              $createImageNode({
                assetId: `sha256:${'a'.repeat(64)}` as AssetId,
                intrinsicWidth: 640,
                intrinsicHeight: 480,
              }),
            )
        },
        { discrete: true },
      ),
    )
    const text = container.querySelector('[data-document-content] p span')!
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 3,
    })
    await act(async () => {
      text.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    editor.getEditorState().read(() => {
      const selection = $getSelection()!
      expect(selection.getTextContent()).toBe('Entire text block')
      expect(
        selection.getNodes().some((node) => node.getType() === 'image'),
      ).toBe(false)
    })
  })

  it('sets editor to non-editable and suppresses mutation affordances in view-only mode', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="view-only" />)
    })

    expect(editorRef.current?.isEditable()).toBe(false)
    expect(container.querySelector('[data-testid="drag-plugin"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="slash-menu-plugin"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="floating-format-toolbar-plugin"]'),
    ).toBeNull()
  })
  it('updates editing and placeholder when access changes on the existing editor', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="edit" />)
    })
    const editor = editorRef.current
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="view-only" />)
    })
    expect(editorRef.current).toBe(editor)
    expect(editor?.isEditable()).toBe(false)
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(container.textContent).not.toContain('Begin typing')
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="edit" />)
    })
    expect(editor?.isEditable()).toBe(true)
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  })
})
