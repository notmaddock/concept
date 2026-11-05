import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { expect, it, vi } from 'vitest'
import { LocalProvider } from '#/lib/documents/local-provider'
import { attachDocumentAssets } from '#/lib/documents/working'
import { collectReferences } from '#/lib/documents/references'
import { insertDocumentAssets } from '#/lib/documents/asset-session'
import type { AssetId, AssetRepository } from '#/lib/documents/assets'
import { DocumentMediaContext } from '../media/document-media-context'
import type { DocumentMediaSession } from '../media/document-media-context'
import { ImageNode } from '../nodes/ImageNode'
import { ImagePlugin } from './ImagePlugin'
import { INSERT_IMAGE_COMMAND } from './commands'

vi.mock('../nodes/ImageBlock', () => ({ ImageBlock: () => null }))
vi.mock('./ingestion', () => ({
  prepareImages: vi.fn(async (files: File[]) => ({
    images: files.map((blob) => ({ blob, width: 20, height: 10 })),
    rejected: [],
  })),
}))

it('inserts exactly one image per picker change with a mounted plugin and bidirectional binding', async () => {
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
  const provider = new LocalProvider('picker-test', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'picker-test',
    doc,
    docMap: new Map([['picker-test', doc]]),
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
  const id = `sha256:${'a'.repeat(64)}` as AssetId
  const repository: AssetRepository = {
    documentId: 'picker-test',
    closed: false,
    put: vi.fn(async () => ({ id, byteLength: 1, mediaType: 'image/png' })),
    get: async () => undefined,
    list: async () => [],
    importAssets: async () => [],
    pin: () => ({ release() {} }),
    flush: async () => {},
    subscribe: () => () => {},
    close() {},
  }
  attachDocumentAssets(doc, repository)
  const flush = vi.fn(async () => {
    expect([...collectReferences(encodeStateAsUpdate(doc))]).toEqual([id])
  })
  const requestSave = vi.fn()
  const signal = new AbortController().signal
  const media: DocumentMediaSession = {
    documentId: 'picker-test',
    doc,
    signal,
    canEdit: () => true,
    isAlive: () => true,
    flush,
    requestSave,
    insert: vi.fn((blobs, insert) =>
      insertDocumentAssets({
        doc,
        blobs,
        insert,
        canEdit: () => true,
        flush,
        requestSave,
        signal,
      }),
    ),
  }
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        paragraph.selectStart()
      },
      { discrete: true },
    )
    await act(async () => {
      root.render(
        <LexicalComposerContext.Provider
          value={[editor, { getTheme: () => null }]}
        >
          <DocumentMediaContext.Provider value={media}>
            <ImagePlugin />
          </DocumentMediaContext.Provider>
        </LexicalComposerContext.Provider>,
      )
    })
    const input = container.querySelector('input')!
    vi.spyOn(input, 'click').mockImplementation(() => {})
    for (let operation = 1; operation <= 2; operation++) {
      await act(async () => {
        editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined)
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [new File(['x'], 'image.png', { type: 'image/png' })],
        })
        input.dispatchEvent(new Event('change', { bubbles: true }))
        // A duplicate browser change must not replay the consumed insertion target.
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      await vi.waitFor(() =>
        expect(media.insert).toHaveBeenCalledTimes(operation),
      )
      expect(
        editor
          .getEditorState()
          .toJSON()
          .root.children.filter((node) => node.type === 'image'),
      ).toHaveLength(operation)
      expect(flush).toHaveBeenCalledTimes(operation)
    }
  } finally {
    await act(() => root.unmount())
    container.remove()
    stop()
    provider.destroy()
    binding.root.destroy(binding)
    doc.destroy()
  }
})
