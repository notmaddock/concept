// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  $isElementNode,
  createEditor,
  HISTORY_PUSH_TAG,
  UNDO_COMMAND,
} from 'lexical'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list'
import { $createQuoteNode, QuoteNode } from '@lexical/rich-text'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { LocalProvider } from '#/lib/documents/local-provider'
import { collectReferences } from '#/lib/documents/references'
import { attachDocumentAssets } from '#/lib/documents/working'
import { describeAsset } from '#/lib/documents/assets'
import type { AssetId, AssetRepository } from '#/lib/documents/assets'
import { insertDocumentAssets } from '#/lib/documents/asset-session'
import { $createImageNode, ImageNode } from '../nodes/ImageNode'
import { captureImageBookmark, restoreImageBookmark } from './bookmark'
import { $insertImageBlocks } from './insert-blocks'

vi.mock('../nodes/ImageBlock', () => ({ ImageBlock: () => null }))
const source = (letter = 'a') => ({
  assetId: `sha256:${letter.repeat(64)}` as AssetId,
  intrinsicWidth: 200,
  intrinsicHeight: 100,
})
function fixture() {
  const editor = createEditor({
    nodes: [ImageNode, ListNode, ListItemNode, QuoteNode],
    onError: (error) => {
      throw error
    },
  })
  const update = (fn: () => void) =>
    editor.update(fn, { discrete: true, tag: HISTORY_PUSH_TAG })
  return {
    editor,
    update,
    json: () => editor.getEditorState().toJSON(),
    text: () => editor.getEditorState().read(() => $getRoot().getTextContent()),
  }
}
it('splits a paragraph and inserts ordered blocks with a trailing text position', () => {
  const f = fixture()
  f.update(() => {
    const text = $createTextNode('beforeafter')
    $getRoot().append($createParagraphNode().append(text))
    text.select(6, 6)
  })
  f.update(() =>
    $insertImageBlocks([
      $createImageNode(source(), 'First'),
      $createImageNode(source('b'), 'Second'),
    ]),
  )
  expect(f.json().root.children.map((node) => node.type)).toEqual([
    'paragraph',
    'image',
    'image',
    'paragraph',
  ])
  expect(f.text()).toContain('[Image: First][Image: Second]')
  expect(
    f.editor
      .getEditorState()
      .read(() => $getRoot().getLastChildOrThrow().getTextContent()),
  ).toBe('after')
})
it.each(['list', 'quote'])(
  'lifts images out of a %s while preserving surrounding structure',
  (container) => {
    const f = fixture()
    f.update(() => {
      const text = $createTextNode('beforeafter')
      $getRoot().append(
        container === 'list'
          ? $createListNode('bullet').append($createListItemNode().append(text))
          : $createQuoteNode().append(text),
      )
      text.select(6, 6)
    })
    f.update(() => $insertImageBlocks([$createImageNode(source())]))
    const children = f.json().root.children
    expect(children.map((node) => node.type)).toEqual([
      container,
      'image',
      container,
    ])
    expect(f.text()).toContain('before')
    expect(f.text()).toContain('after')
  },
)
it('restores the captured caret instead of inserting at a later selection', () => {
  const f = fixture()
  f.update(() => {
    const a = $createTextNode('first')
    const b = $createTextNode('second')
    $getRoot().append(
      $createParagraphNode().append(a),
      $createParagraphNode().append(b),
    )
    a.selectEnd()
  })
  const bookmark = captureImageBookmark(f.editor)!
  f.update(() => $getRoot().getLastChildOrThrow().selectEnd())
  f.update(() => {
    restoreImageBookmark(bookmark)
    $insertImageBlocks([$createImageNode(source())])
  })
  expect(f.text().indexOf('[Image]')).toBeLessThan(f.text().indexOf('second'))
})
it.each(['delete', 'edit'])(
  'rejects a bookmark after target %s without changing content',
  (operation) => {
    const f = fixture()
    f.update(() => {
      const p = $createParagraphNode().append($createTextNode('original'))
      $getRoot().append(p)
      p.selectEnd()
    })
    const bookmark = captureImageBookmark(f.editor)!
    f.update(() => {
      const p = $getRoot().getFirstChildOrThrow()
      if (operation === 'delete') p.remove()
      else {
        if (!$isElementNode(p)) throw new Error('Expected paragraph')
        const text = p.getFirstChildOrThrow()
        if ($isTextNode(text)) text.setTextContent('changed')
      }
    })
    const before = f.json()
    let error: unknown
    f.update(() => {
      try {
        restoreImageBookmark(bookmark)
      } catch (value) {
        error = value
      }
    })
    expect(error).toBeInstanceOf(Error)
    expect(f.json()).toEqual(before)
  },
)
it('undoes an ordered image batch in one action', async () => {
  const f = fixture()
  const stop = registerHistory(f.editor, createEmptyHistoryState(), 0)
  try {
    f.update(() => {
      const p = $createParagraphNode().append($createTextNode('Start'))
      $getRoot().append(p)
      p.selectEnd()
    })
    f.update(() =>
      $insertImageBlocks([
        $createImageNode(source(), 'One'),
        $createImageNode(source('b'), 'Two'),
      ]),
    )
    f.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await Promise.resolve()
    expect(f.text()).toBe('Start')
  } finally {
    stop()
  }
})
it('persists all bytes before binding references and synchronizes discrete updates before flush', async () => {
  const f = fixture()
  const doc = new Doc()
  const provider = new LocalProvider('insertion-contract', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor: f.editor,
    id: 'insertion-contract',
    doc,
    docMap: new Map([['insertion-contract', doc]]),
  })
  const stop = f.editor.registerUpdateListener(
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
  const blobs = new Map<AssetId, Blob>()
  const repository: AssetRepository = {
    documentId: 'insertion-contract',
    closed: false,
    put: async (blob) => {
      const descriptor = await describeAsset(blob)
      blobs.set(descriptor.id, blob)
      return descriptor
    },
    get: async (id) => blobs.get(id),
    list: async () => [],
    importAssets: async () => [],
    pin: () => ({ release() {} }),
    flush: async () => {},
    subscribe: () => () => {},
    close() {},
  }
  attachDocumentAssets(doc, repository)
  const save = vi.fn()
  try {
    f.update(() => {
      const p = $createParagraphNode()
      $getRoot().append(p)
      p.selectStart()
    })
    const outcome = await insertDocumentAssets({
      doc,
      blobs: [new Blob(['first']), new Blob(['second'])],
      canEdit: () => true,
      insert: (descriptors) => {
        expect(blobs.size).toBe(2)
        f.update(() =>
          $insertImageBlocks(
            descriptors.map((descriptor) =>
              $createImageNode({ ...source(), assetId: descriptor.id }),
            ),
          ),
        )
      },
      flush: async () => {
        const ids = collectReferences(encodeStateAsUpdate(doc))
        expect(ids.size).toBe(2)
        for (const id of ids) expect(blobs.has(id)).toBe(true)
      },
      requestSave: save,
    })
    expect(outcome.status).toBe('inserted')
    expect(save).toHaveBeenCalledOnce()
  } finally {
    stop()
    provider.destroy()
    binding.root.destroy(binding)
    doc.destroy()
  }
})
