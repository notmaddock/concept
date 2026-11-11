import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { CodeNode } from '@lexical/code'
import { $createImageNode } from './nodes/ImageNode'
import type { AssetId } from '#/lib/documents/assets'
import { Nova } from './Nova'
import { getSelectedNode } from './utils/getSelectedNode'
import { ResizableNode } from './nodes/ResizableNode'

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

  it('registers link, autolink, and code nodes', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} mode="edit" />)
    })
    expect(
      editorRef.current?.hasNodes([LinkNode, AutoLinkNode, CodeNode]),
    ).toBe(true)
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

  it('cleans up editorRef.current to null on unmount', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} />)
    })
    expect(editorRef.current).not.toBeNull()
    await act(async () => {
      root.render(<div>unmounted</div>)
    })
    expect(editorRef.current).toBeNull()
  })
  it('cleans up callback editorRef with null on unmount', async () => {
    const editorRef = vi.fn()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} />)
    })
    expect(editorRef).toHaveBeenCalledWith(expect.anything())
    await act(async () => {
      root.render(<div>unmounted</div>)
    })
    expect(editorRef).toHaveBeenLastCalledWith(null)
  })

  it('safely handles non-range selections in getSelectedNode', () => {
    expect(getSelectedNode(null)).toBeNull()
    expect(getSelectedNode(undefined)).toBeNull()
    expect(getSelectedNode({})).toBeNull()
    expect(getSelectedNode({ anchor: {} })).toBeNull()
  })
  it('returns selected text node when range selection is present', async () => {
    const editorRef = createRef<LexicalEditor>()
    await act(async () => {
      root.render(<Nova editorRef={editorRef} />)
    })
    const editor = editorRef.current!
    await act(async () => {
      editor.update(() => {
        const rootNode = $getRoot()
        rootNode.clear()
        const textNode = $createTextNode('Sample text')
        const paragraph = $createParagraphNode().append(textNode)
        rootNode.append(paragraph)
        textNode.select(0, 6)
      })
    })
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      const selectedNode = getSelectedNode(selection)
      expect(selectedNode).not.toBeNull()
      expect(selectedNode?.getTextContent()).toBe('Sample text')
    })
  })

  describe('ResizableNode', () => {
    class MockResizableNode extends ResizableNode<null> {
      static getType() {
        return 'mock-resizable'
      }
      static clone(node: MockResizableNode) {
        return new MockResizableNode(
          node.__displayWidth,
          node.__key,
          node.__alignment,
        )
      }
      createDOM() {
        return document.createElement('div')
      }
      updateDOM() {
        return false
      }
      decorate() {
        return null
      }
      public validateWidth(width: number | null) {
        return this.validateDisplayWidth(width)
      }
    }

    it('verifies dimensions are finite and clamps to positive numbers', () => {
      const editor = createEditor({ nodes: [MockResizableNode] })
      editor.update(
        () => {
          const node = new MockResizableNode(200)
          expect(node.__displayWidth).toBe(200)

          const zeroNode = new MockResizableNode(0)
          expect(zeroNode.__displayWidth).toBe(1)

          const negativeNode = new MockResizableNode(-50)
          expect(negativeNode.__displayWidth).toBe(1)

          const nullNode = new MockResizableNode(null)
          expect(nullNode.__displayWidth).toBeNull()

          expect(node.validateWidth(350)).toBe(350)
          expect(node.validateWidth(0)).toBe(1)
          expect(node.validateWidth(-100)).toBe(1)
          expect(node.validateWidth(null)).toBeNull()

          expect(() => new MockResizableNode(NaN)).toThrow(
            'Invalid display width',
          )
          expect(() => new MockResizableNode(Infinity)).toThrow(
            'Invalid display width',
          )
          expect(() => new MockResizableNode(-Infinity)).toThrow(
            'Invalid display width',
          )
          expect(() => node.validateWidth(NaN)).toThrow('Invalid display width')
          expect(() => node.validateWidth(Infinity)).toThrow(
            'Invalid display width',
          )
          expect(() => node.validateWidth(-Infinity)).toThrow(
            'Invalid display width',
          )
        },
        { discrete: true },
      )
    })
  })
})
