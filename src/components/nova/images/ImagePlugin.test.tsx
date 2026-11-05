import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
} from 'lexical'
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
import { getBlockOptions } from '../plugins/SlashMenuPlugin/options'

vi.mock('../nodes/ImageBlock', () => ({ ImageBlock: () => null }))
vi.mock('./ingestion', () => ({
  prepareImages: vi.fn(async (files: File[]) => ({
    images: files.map((blob) => ({ blob, width: 20, height: 10 })),
    rejected: [],
  })),
}))

it.each(['picker', 'slash', 'drop', 'firefox-drop'])(
  'arbitrates %s insertion with a mounted plugin and bidirectional binding',
  async (entryPoint) => {
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
    let editorRoot: HTMLDivElement | undefined
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
      if (entryPoint === 'picker' || entryPoint === 'slash') {
        for (let operation = 1; operation <= 2; operation++) {
          await act(async () => {
            if (entryPoint === 'slash') {
              editor.update(
                () => {
                  const paragraph = $getRoot().getLastChildOrThrow()
                  if (!$isElementNode(paragraph))
                    throw new Error('Expected paragraph')
                  const query = $createTextNode('/image')
                  paragraph.append(query)
                  query.selectEnd()
                  query.remove()
                  getBlockOptions(editor, true)
                    .find((option) => option.key === 'image')!
                    .onSelect()
                },
                { discrete: true },
              )
            } else editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined)
            expect(input.click).toHaveBeenCalledTimes(operation)
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
      } else {
        editorRoot = document.createElement('div')
        document.body.append(editorRoot)
        await act(async () => {
          editor.setRootElement(editorRoot!)
          editor.update(
            () => {
              $getRoot()
                .clear()
                .append(
                  $createParagraphNode().append($createTextNode('beforeafter')),
                )
            },
            { discrete: true },
          )
        })
        const range = document.createRange()
        const text = editorRoot.querySelector('p span')!.firstChild!
        range.setStart(text, 6)
        range.collapse(true)
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: entryPoint === 'firefox-drop' ? undefined : vi.fn(() => range),
        })
        Object.defineProperty(document, 'caretPositionFromPoint', {
          configurable: true,
          value: vi.fn(() => ({ offsetNode: text, offset: 6 })),
        })
        const first = new File(['first'], 'first.png', { type: 'image/png' })
        const second = new File(['second'], 'second.png', { type: 'image/png' })
        const drop = (types: string[], files: File[]) => {
          const event = new MouseEvent('drop', {
            clientX: 10,
            clientY: 20,
            cancelable: true,
          })
          Object.defineProperty(event, 'dataTransfer', {
            value: { types, files, items: [] },
          })
          return event as DragEvent
        }
        const internal = drop(
          ['Files', 'application/x-lexical-drag-block'],
          [first],
        )
        const plain = drop(['text/plain'], [])
        const unsupported = drop(
          ['Files'],
          [new File(['x'], 'file.pdf', { type: 'application/pdf' })],
        )
        await act(async () => {
          expect(editor.dispatchCommand(DRAGOVER_COMMAND, internal)).toBe(false)
          expect(editor.dispatchCommand(DRAGOVER_COMMAND, plain)).toBe(false)
          expect(editor.dispatchCommand(DRAGOVER_COMMAND, unsupported)).toBe(
            false,
          )
          expect(editor.dispatchCommand(DROP_COMMAND, internal)).toBe(false)
          expect(editor.dispatchCommand(DROP_COMMAND, plain)).toBe(false)
          expect(editor.dispatchCommand(DROP_COMMAND, unsupported)).toBe(false)
        })
        expect(internal.defaultPrevented).toBe(false)
        expect(plain.defaultPrevented).toBe(false)
        expect(unsupported.defaultPrevented).toBe(false)
        expect(media.insert).not.toHaveBeenCalled()
        const external = drop(['Files'], [first, second])
        await act(async () => {
          expect(editor.dispatchCommand(DROP_COMMAND, external)).toBe(true)
          await Promise.resolve()
          await Promise.resolve()
          await Promise.resolve()
          await Promise.resolve()
        })
        await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
        expect(external.defaultPrevented).toBe(true)
        expect(vi.mocked(media.insert).mock.calls[0][0]).toEqual([
          first,
          second,
        ])
        const children = editor.getEditorState().toJSON().root.children
        expect(children.map((node) => node.type)).toEqual([
          'paragraph',
          'image',
          'image',
          'paragraph',
        ])
        expect(
          editor
            .getEditorState()
            .read(() => $getRoot().getFirstChildOrThrow().getTextContent()),
        ).toBe('before')
        expect(
          editor
            .getEditorState()
            .read(() => $getRoot().getLastChildOrThrow().getTextContent()),
        ).toBe('after')
        delete (document as Partial<Document>).caretRangeFromPoint
        delete (document as Partial<Document>).caretPositionFromPoint
      }
    } finally {
      editor.setRootElement(null)
      editorRoot?.remove()
      await act(() => root.unmount())
      container.remove()
      stop()
      provider.destroy()
      binding.root.destroy(binding)
      doc.destroy()
    }
  },
)
