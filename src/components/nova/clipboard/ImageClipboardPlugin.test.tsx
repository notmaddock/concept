import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $selectAll,
  PASTE_COMMAND,
  COPY_COMMAND,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { QuoteNode } from '@lexical/rich-text'
import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { ImageNode } from '../nodes/ImageNode'
import { ImageClipboardPlugin } from './ImageClipboardPlugin'
import { DocumentMediaContext } from '../media/document-media-context'
import { assetId, openAssetRepository } from '#/lib/documents/assets'
import { attachDocumentAssets } from '#/lib/documents/working'
import {
  insertDocumentAssets,
  createDocumentAssetResolver,
} from '#/lib/documents/asset-session'
import { collectReferences } from '#/lib/documents/references'
import { LocalProvider } from '#/lib/documents/local-provider'
import { imageDataUrl } from '#/lib/documents/image-transfer'
import { fragmentHtml } from './fragment'

vi.mock('../nodes/ImageBlock', () => ({ ImageBlock: () => null }))
vi.mock('../images/ingestion', () => ({
  prepareImage: async (blob: Blob) => ({ blob, width: 20, height: 10 }),
}))

it('owns transferred bytes before inserting the entire selected tree into a bound destination', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('indexedDB', new IDBFactory())
  const doc = new Doc()
  const repository = openAssetRepository(crypto.randomUUID())
  const detach = attachDocumentAssets(doc, repository)
  const signal = new AbortController().signal
  const flush = vi.fn(async () => {
    const ids = [...collectReferences(encodeStateAsUpdate(doc))]
    expect(ids).toHaveLength(1)
    expect(await repository.get(ids[0])).toBeDefined()
  })
  const requestSave = vi.fn()
  const resolver = createDocumentAssetResolver({ repository })
  const media = {
    resolver,
    doc,
    documentId: repository.documentId,
    signal,
    canEdit: () => true,
    isAlive: () => true,
    flush,
    requestSave,
    insert: (
      blobs: readonly Blob[],
      insert: Parameters<typeof insertDocumentAssets>[0]['insert'],
    ) =>
      insertDocumentAssets({
        doc,
        blobs,
        insert,
        canEdit: () => true,
        flush,
        requestSave,
      }),
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  const editorRef = createRef<LexicalEditor>()
  await act(async () => {
    root.render(
      <DocumentMediaContext value={media}>
        <LexicalComposer
          initialConfig={{
            namespace: 'clipboard-test',
            nodes: [ImageNode, QuoteNode],
            onError: (error) => {
              throw error
            },
          }}
        >
          <EditorRefPlugin editorRef={editorRef} />
          <ImageClipboardPlugin />
        </LexicalComposer>
      </DocumentMediaContext>,
    )
  })
  const editor = editorRef.current!
  const provider = new LocalProvider('clipboard-test', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'clipboard-test',
    doc,
    docMap: new Map([['clipboard-test', doc]]),
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
  try {
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('replace me')),
        )
        $selectAll()
      },
      { discrete: true },
    )
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    })
    const id = await assetId(await blob.arrayBuffer())
    const paragraph = (text: string) => ({
      type: 'paragraph',
      version: 1,
      children: [
        {
          type: 'text',
          version: 1,
          text,
          format: 1,
          style: '',
          mode: 'normal',
          detail: 0,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
    })
    const image = {
      type: 'image',
      version: 1,
      source: { assetId: id, intrinsicWidth: 20, intrinsicHeight: 10 },
      altText: 'Transferred',
      displayWidth: 120,
    }
    const nodes = [
      paragraph('Before'),
      image,
      {
        type: 'quote',
        version: 1,
        children: [paragraph('Nested')],
        direction: null,
        format: '',
        indent: 0,
      },
      { ...image, altText: 'Repeated' },
      paragraph('After'),
    ]
    let html = fragmentHtml('<p>HTML preview must not duplicate content</p>', {
      version: 1,
      nodes,
      assets: { [id]: await imageDataUrl(blob) },
    })
    let clipboardFiles: File[] = []
    class PasteEvent extends Event {
      clipboardData = {
        getData: (type: string) => (type === 'text/html' ? html : ''),
        files: clipboardFiles,
      }
    }
    vi.stubGlobal('ClipboardEvent', PasteEvent)
    await act(async () => {
      editor.dispatchCommand(
        PASTE_COMMAND,
        new PasteEvent('paste', {
          cancelable: true,
        }) as unknown as ClipboardEvent,
      )
      await vi.waitFor(() => expect(requestSave).toHaveBeenCalledOnce(), {
        timeout: 3000,
        interval: 10,
      })
    })
    expect(requestSave).toHaveBeenCalledOnce()
    expect(
      editor
        .getEditorState()
        .toJSON()
        .root.children.map((node) => node.type),
    ).toEqual(['paragraph', 'image', 'quote', 'image', 'paragraph'])
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toContain('Nested')
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).not.toContain('replace me')
    expect((await repository.list()).length).toBe(1)
    expect([...collectReferences(encodeStateAsUpdate(doc))]).toEqual([id])
    editor.update(
      () => {
        $selectAll()
      },
      { discrete: true },
    )
    const release = vi.fn()
    const originalPin = repository.pin
    const pin = vi.spyOn(repository, 'pin').mockImplementation((ids) => {
      const held = originalPin(ids)
      return {
        release: () => {
          release()
          held.release()
        },
      }
    })
    let publish!: () => void
    const publication = new Promise<void>((resolve) => {
      publish = resolve
    })
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', {
      clipboard: {
        write: async (items: TestClipboardItem[]) => {
          await Promise.all(Object.values(items[0].data))
          await publication
        },
      },
    })
    await act(async () => {
      editor.dispatchCommand(COPY_COMMAND, null)
    })
    expect(pin).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    await act(async () => {
      publish()
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce(), {
        timeout: 3000,
        interval: 10,
      })
    })
    expect(release).toHaveBeenCalledOnce()
    pin.mockRestore()
    editor.update(
      () => {
        $selectAll()
      },
      { discrete: true },
    )
    const before = editor.getEditorState().toJSON()
    requestSave.mockClear()
    const validHtml = html
    html = fragmentHtml('<p>Untrusted</p>', {
      version: 1,
      nodes,
      assets: { [id]: 'data:image/png;base64,iVBORw0KGgox' },
    })
    await act(async () => {
      editor.dispatchCommand(
        PASTE_COMMAND,
        new PasteEvent('paste', {
          cancelable: true,
        }) as unknown as ClipboardEvent,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(requestSave).not.toHaveBeenCalled()
    expect(editor.getEditorState().toJSON()).toEqual(before)
    html = validHtml
    vi.spyOn(repository, 'put').mockRejectedValueOnce(
      new Error('Quota exceeded'),
    )
    await act(async () => {
      editor.dispatchCommand(
        PASTE_COMMAND,
        new PasteEvent('paste', {
          cancelable: true,
        }) as unknown as ClipboardEvent,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(requestSave).not.toHaveBeenCalled()
    expect(editor.getEditorState().toJSON()).toEqual(before)
    html =
      '<p>Before sticker</p><img src="blob:https://web.whatsapp.com/sticker" alt="Sticker"><p>After sticker</p>'
    clipboardFiles = [new File([blob], 'sticker.png', { type: 'image/png' })]
    await act(async () => {
      editor.dispatchCommand(
        PASTE_COMMAND,
        new PasteEvent('paste', {
          cancelable: true,
        }) as unknown as ClipboardEvent,
      )
      await vi.waitFor(() => expect(requestSave).toHaveBeenCalledOnce(), {
        timeout: 3000,
        interval: 10,
      })
    })
    expect(
      editor
        .getEditorState()
        .toJSON()
        .root.children.map((node) => node.type),
    ).toEqual(['paragraph', 'image', 'paragraph'])
    const pastedText = editor
      .getEditorState()
      .read(() => $getRoot().getTextContent())
    expect(pastedText).toContain('Before sticker')
    expect(pastedText).toContain('After sticker')
    expect(editor.getEditorState().toJSON().root.children[1]).toMatchObject({
      source: { assetId: id },
      altText: 'Sticker',
    })
  } finally {
    resolver.close()
    stop()
    provider.destroy()
    binding.root.destroy(binding)
    await act(() => root.unmount())
    detach()
    repository.close()
    doc.destroy()
    vi.unstubAllGlobals()
  }
})
