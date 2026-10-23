import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { LexicalEditor } from 'lexical'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova } from './Nova'

const mocks = vi.hoisted(() => ({
  pageSetupPlugin: vi.fn(),
  slashMenuPlugin: vi.fn(),
  dragPlugin: vi.fn(),
  floatingToolbarPlugin: vi.fn(),
}))

vi.mock('#/components/documents/page-setup/PageSetupPlugin', () => ({
  PageSetupPlugin: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => {
    mocks.pageSetupPlugin(props)
    return (
      <div data-testid="page-setup-plugin" data-open={String(props.open)} />
    )
  },
}))

vi.mock('./plugins/SlashMenuPlugin/SlashMenuPlugin', () => ({
  SlashMenuPlugin: () => {
    mocks.slashMenuPlugin()
    return <div data-testid="slash-menu-plugin" />
  },
}))

vi.mock('./plugins/DragPlugin/DragPlugin', () => ({
  DragPlugin: ({ anchorElement }: { anchorElement: HTMLElement }) => {
    mocks.dragPlugin(anchorElement)
    return <div data-testid="drag-plugin" />
  },
}))

vi.mock('./plugins/FormatToolbarPlugin', () => ({
  FloatingTextFormatToolbarPlugin: () => {
    mocks.floatingToolbarPlugin()
    return <div data-testid="floating-toolbar-plugin" />
  },
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Nova', () => {
  it('mounts standalone editor extension, populates editorRef, and attaches core plugins', async () => {
    const editorRef = createRef<LexicalEditor | null>()
    const onPageSetupOpenChange = vi.fn()

    await act(async () => {
      root.render(
        <Nova
          editorRef={editorRef}
          pageSetupOpen={true}
          onPageSetupOpenChange={onPageSetupOpenChange}
        />,
      )
    })

    expect(editorRef.current).not.toBeNull()
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="slash-menu-plugin"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="floating-toolbar-plugin"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="drag-plugin"]'),
    ).not.toBeNull()
    expect(mocks.dragPlugin).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    expect(mocks.pageSetupPlugin).toHaveBeenCalledWith({
      open: true,
      onOpenChange: onPageSetupOpenChange,
    })
  })

  it('switches to collaborativeEditorExtension and renders collaboration children when provided', async () => {
    const editorRef = createRef<LexicalEditor | null>()

    await act(async () => {
      root.render(
        <Nova
          editorRef={editorRef}
          collaboration={<div data-testid="collab-provider">Synced</div>}
        />,
      )
    })

    expect(editorRef.current).not.toBeNull()
    expect(
      container.querySelector('[data-testid="collab-provider"]')?.textContent,
    ).toBe('Synced')

    // Collaborative extension initializes an empty state ($initialEditorState: null)
    // so Yjs collaboration controls initial content population.
    editorRef.current!.getEditorState().read(() => {
      expect(editorRef.current!.getEditorState().isEmpty()).toBe(true)
    })
  })
})
