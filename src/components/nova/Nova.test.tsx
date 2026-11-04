import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LexicalEditor } from 'lexical'
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
