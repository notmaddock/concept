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
    await act(async () => {
      document.querySelector<HTMLElement>('[role="menuitem"]')!.click()
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
    await act(async () => editor.setEditable(false))
    expect(document.querySelector('fieldset')!.disabled).toBe(true)
    expect(
      document.querySelector('[role="dialog"]')!.textContent,
    ).not.toContain('Delete image')
    expect(
      document.querySelector('[role="dialog"]')!.textContent,
    ).not.toContain('Replace image')
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
