import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { expect, it, vi } from 'vitest'
import { LocalProvider } from '#/lib/documents/local-provider'
import type { AssetId } from '#/lib/documents/assets'
import { DocumentMediaContext } from '../media/document-media-context'
import type { DocumentMediaSession } from '../media/document-media-context'
import { $createImageNode, ImageNode } from './ImageNode'

vi.mock('../images/use-renderable-image', () => ({
  useRenderableImage: () => ({ url: undefined, failure: undefined }),
}))

vi.mock('../media/use-document-asset', () => ({
  useDocumentAsset: () => ({
    state: { state: 'available', blob: new Blob(['image']) },
    retry: vi.fn(),
  }),
}))

it('commits mounted metadata controls through bidirectional Yjs and persisted reload', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const doc = new Doc()
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error
    },
  })
  const provider = new LocalProvider('block-test', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'block-test',
    doc,
    docMap: new Map([['block-test', doc]]),
  })
  const stop = editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyElements,
      dirtyLeaves,
      normalizedNodes,
      tags,
    }) =>
      syncLexicalUpdateToYjs(
        binding,
        provider,
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      ),
  )
  binding.root.getSharedType().observeDeep((events, transaction) => {
    if (transaction.origin !== binding)
      syncYjsChangesToLexical(binding, provider, events, false)
  })
  const source = {
    assetId: `sha256:${'a'.repeat(64)}` as AssetId,
    intrinsicWidth: 200,
    intrinsicHeight: 100,
  }
  const media: DocumentMediaSession = {
    documentId: 'block-test',
    doc,
    signal: new AbortController().signal,
    canEdit: () => true,
    isAlive: () => true,
    flush: async () => {},
    requestSave: () => {},
    insert: vi.fn(),
  }
  try {
    await act(async () => {
      root.render(
        <LexicalComposerContext.Provider
          value={[editor, { getTheme: () => null }]}
        >
          <DocumentMediaContext.Provider value={media}>
            <RichTextPlugin
              contentEditable={<ContentEditable />}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </DocumentMediaContext.Provider>
        </LexicalComposerContext.Provider>,
      )
      editor.update(
        () => {
          $getRoot().append($createImageNode(source), $createParagraphNode())
        },
        { discrete: true },
      )
    })
    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')!.click()
    })
    expect(container.querySelector('[aria-label="Image alt text"]')).toBeNull()
    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          clientX: 10,
          clientY: 10,
        }),
      )
    })
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull()
    await act(async () => {
      document
        .querySelector<HTMLElement>('[data-slot="context-menu-sub-trigger"]')!
        .click()
    })
    expect(
      document.querySelector('[role="menuitemradio"][aria-checked="true"]')!
        .textContent,
    ).toContain('Align left')
    await act(async () => {
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      )
        .find((item) => item.textContent.includes('Align right'))!
        .click()
    })
    expect(editor.getEditorState().toJSON().root.children[0]).toMatchObject({
      alignment: 'right',
    })
    expect(
      container.querySelector<HTMLElement>('[role="button"]')!.style.marginLeft,
    ).toBe('auto')
    expect(
      container.querySelector<HTMLElement>('[role="button"]')!.style
        .marginRight,
    ).toBe('0px')
    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          clientX: 10,
          clientY: 10,
        }),
      )
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent.includes('Image Options'))!
        .click()
    })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      'a'.repeat(64),
    )
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      '5 bytes',
    )
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Image alt text"]',
    )!
    expect(input).not.toBeNull()
    await act(async () => {
      input.focus()
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'Photo description')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.blur()
    })
    expect(
      editor
        .getEditorState()
        .read(() => $getRoot().getFirstChildOrThrow().getTextContent()),
    ).toBe('[Image: Photo description]')
    expect(
      container.querySelector('[aria-label="Image: Photo description"]'),
    ).not.toBeNull()
    let width = document.querySelector<HTMLInputElement>(
      '[aria-label="Image width"]',
    )!
    await act(async () => {
      width.focus()
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(width, '123')
      width.dispatchEvent(new Event('input', { bubbles: true }))
      width.blur()
    })
    width = document.querySelector<HTMLInputElement>(
      '[aria-label="Image width"]',
    )!
    await act(async () => {
      width.focus()
      width.value = '0'
      width.blur()
    })
    expect(width.value).toBe('123')
    const image = editor.getEditorState().toJSON().root.children[0]
    expect(image).toMatchObject({
      altText: 'Photo description',
      displayWidth: 123,
    })
    const restoredDoc = new Doc()
    const restoredEditor = createEditor({
      nodes: [ImageNode],
      onError: (error) => {
        throw error
      },
    })
    const restoredProvider = new LocalProvider('restored', restoredDoc, {
      whenSynced: Promise.resolve(),
      destroy: async () => {},
    })
    const restoredBinding = createYjsBinding({
      editor: restoredEditor,
      id: 'restored',
      doc: restoredDoc,
      docMap: new Map([['restored', restoredDoc]]),
    })
    restoredBinding.root
      .getSharedType()
      .observeDeep((events) =>
        syncYjsChangesToLexical(
          restoredBinding,
          restoredProvider,
          events,
          false,
        ),
      )
    applyUpdate(restoredDoc, encodeStateAsUpdate(doc))
    await Promise.resolve()
    expect(restoredEditor.getEditorState().toJSON().root.children[0]).toEqual(
      image,
    )
    const naturalSize = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Natural size',
    )!
    await act(async () => {
      naturalSize.focus()
      naturalSize.click()
    })
    expect(document.activeElement).toBe(naturalSize)
    await act(async () => editor.setEditable(false))
    expect(document.querySelector('fieldset')!.disabled).toBe(true)
    expect(
      document.querySelector('[role="dialog"]')!.textContent,
    ).not.toContain('Delete image')
    expect(
      document.querySelector('[role="dialog"]')!.textContent,
    ).not.toContain('Replace image')
    await act(async () => {
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Done')!
        .click()
    })
    const openContextMenu = () =>
      container.querySelector<HTMLElement>('[role="button"]')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          clientX: 10,
          clientY: 10,
        }),
      )
    await act(async () => {
      openContextMenu()
    })
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull()
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some((item) =>
        item.textContent.includes('Delete image'),
      ),
    ).toBe(false)
    await act(async () => editor.setEditable(true))
    expect(
      document.querySelector('[data-slot="context-menu-sub-trigger"]')!
        .textContent,
    ).toContain('Align image')
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent.includes('Delete image'))!
        .click()
    })
    expect(editor.getEditorState().toJSON().root.children).toHaveLength(1)
    expect(
      container.querySelector('[aria-label="Image: Photo description"]'),
    ).toBeNull()
    restoredProvider.destroy()
    restoredBinding.root.destroy(restoredBinding)
    restoredDoc.destroy()
  } finally {
    await act(() => root.unmount())
    container.remove()
    stop()
    provider.destroy()
    binding.root.destroy(binding)
    doc.destroy()
  }
})

it('does not convert responsive image to fixed pixel width when clicking resize handle without dragging', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error
    },
  })
  const media: DocumentMediaSession = {
    documentId: 'click-test',
    doc: new Doc(),
    signal: new AbortController().signal,
    canEdit: () => true,
    isAlive: () => true,
    flush: async () => {},
    requestSave: () => {},
    insert: vi.fn(),
  }
  const source = {
    assetId: `sha256:${'c'.repeat(64)}` as AssetId,
    intrinsicWidth: 500,
    intrinsicHeight: 300,
  }
  try {
    await act(async () => {
      root.render(
        <LexicalComposerContext.Provider
          value={[editor, { getTheme: () => null }]}
        >
          <DocumentMediaContext.Provider value={media}>
            <RichTextPlugin
              contentEditable={<ContentEditable />}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </DocumentMediaContext.Provider>
        </LexicalComposerContext.Provider>,
      )
      editor.update(
        () => {
          $getRoot().append($createImageNode(source))
        },
        { discrete: true },
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')!.click()
    })
    const handle = container.querySelector<HTMLElement>(
      '[aria-label="Resize image from bottom right"]',
    )!
    expect(handle).not.toBeNull()

    // Pointerdown and pointerup without move
    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 200, bubbles: true }),
      )
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 200, bubbles: true }),
      )
    })

    const widthAfterClick = editor
      .getEditorState()
      .read(() =>
        ($getRoot().getFirstChildOrThrow() as ImageNode).getDisplayWidth(),
      )
    expect(widthAfterClick).toBeNull()

    // Pointerdown, move, and pointerup (dragging)
    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 200, bubbles: true }),
      )
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 250, bubbles: true }),
      )
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: 250, bubbles: true }),
      )
    })

    const widthAfterDrag = editor
      .getEditorState()
      .read(() =>
        ($getRoot().getFirstChildOrThrow() as ImageNode).getDisplayWidth(),
      )
    expect(widthAfterDrag).not.toBeNull()
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})

it('resizes via keyboard using visible width when displayWidth is null and clamps to container width', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error
    },
  })
  const media: DocumentMediaSession = {
    documentId: 'kb-test',
    doc: new Doc(),
    signal: new AbortController().signal,
    canEdit: () => true,
    isAlive: () => true,
    flush: async () => {},
    requestSave: () => {},
    insert: vi.fn(),
  }
  const source = {
    assetId: `sha256:${'d'.repeat(64)}` as AssetId,
    intrinsicWidth: 1000,
    intrinsicHeight: 600,
  }
  try {
    await act(async () => {
      root.render(
        <LexicalComposerContext.Provider
          value={[editor, { getTheme: () => null }]}
        >
          <DocumentMediaContext.Provider value={media}>
            <RichTextPlugin
              contentEditable={<ContentEditable />}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </DocumentMediaContext.Provider>
        </LexicalComposerContext.Provider>,
      )
      editor.update(
        () => {
          $getRoot().append($createImageNode(source))
        },
        { discrete: true },
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')!.click()
    })

    const block = container.querySelector<HTMLElement>('[role="button"]')!
    const handle = container.querySelector<HTMLElement>(
      '[aria-label="Resize image from bottom right"]',
    )!

    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 240,
      top: 0,
      left: 0,
      bottom: 240,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    Object.defineProperty(block.parentElement!, 'clientWidth', {
      value: 450,
      configurable: true,
    })

    // Resizing left (-10) with displayWidth: null should start from visible width 400 -> 390
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      )
    })
    const widthAfterLeft = editor
      .getEditorState()
      .read(() =>
        ($getRoot().getFirstChildOrThrow() as ImageNode).getDisplayWidth(),
      )
    expect(widthAfterLeft).toBe(390)

    // Set displayWidth to 445 (close to container width 450)
    await act(async () => {
      editor.update(() => {
        ;($getRoot().getFirstChildOrThrow() as ImageNode).setDisplayWidth(445)
      })
    })

    // Resizing right (+10): 445 + 10 = 455, clamped to container width 450
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
    })
    const widthAfterRight = editor
      .getEditorState()
      .read(() =>
        ($getRoot().getFirstChildOrThrow() as ImageNode).getDisplayWidth(),
      )
    expect(widthAfterRight).toBe(450)
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})
