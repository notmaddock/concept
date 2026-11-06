// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { $getNodeByKey, $getRoot, createEditor } from 'lexical'
import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'
import { LocalProvider } from '@/lib/documents/local-provider'
import { collectReferences } from '@/lib/documents/references'
import { validateImageSource } from '@/lib/documents/image-schema'
import { $createImageNode, ImageNode } from './ImageNode'
import { ResizableNode } from './ResizableNode'
import type { AssetId } from '@/lib/documents/assets'

vi.mock('./ImageBlock', () => ({ ImageBlock: () => null }))
const source = (letter: string, width = 640, height = 480) => ({
  assetId: `sha256:${letter.repeat(64)}` as AssetId,
  intrinsicWidth: width,
  intrinsicHeight: height,
})
function client() {
  const doc = new Doc()
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error
    },
  })
  const provider = new LocalProvider('image-test', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'image-test',
    doc,
    docMap: new Map([['image-test', doc]]),
  })
  const unregister = editor.registerUpdateListener(
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
  return {
    doc,
    editor,
    close: () => {
      unregister()
      provider.destroy()
      binding.root.destroy(binding)
      doc.destroy()
    },
  }
}
it('round trips image placement JSON and rejects invalid or future fields', () => {
  const { editor, close } = client()
  try {
    editor.update(
      () => {
        $getRoot().append($createImageNode(source('a'), 'A photo', 200))
      },
      { discrete: true },
    )
    const json = editor.getEditorState().toJSON()
    const parsed = editor.parseEditorState(json)
    expect(parsed.toJSON()).toEqual(json)
    expect(parsed.read(() => $getRoot().getTextContent())).toBe(
      '[Image: A photo]',
    )
    const image = json.root.children[0]
    expect(() =>
      editor.parseEditorState({
        ...json,
        root: { ...json.root, children: [{ ...image, version: 2 }] },
      }),
    ).toThrow()
    expect(() => validateImageSource(source('z'))).toThrow()
    expect(() => validateImageSource(source('a', 0))).toThrow()
    expect(() => validateImageSource(source('a', 16000, 16000))).toThrow()
  } finally {
    close()
  }
})
it('discovers actual binding references before React mounts and keeps frozen snapshots', () => {
  const { doc, editor, close } = client()
  try {
    editor.update(
      () => {
        $getRoot().append(
          $createImageNode(source('a')),
          $createImageNode(source('a'), 'Other', 100),
        )
      },
      { discrete: true },
    )
    const snapshot = encodeStateAsUpdate(doc)
    expect([...collectReferences(snapshot)]).toEqual([source('a').assetId])
    editor.update(
      () => {
        $getRoot().clear()
      },
      { discrete: true },
    )
    expect([...collectReferences(encodeStateAsUpdate(doc))]).toEqual([])
    expect([...collectReferences(snapshot)]).toEqual([source('a').assetId])
  } finally {
    close()
  }
})
it('merges concurrent replacements as complete source records and presentation independently', async () => {
  const a = client()
  const b = client()
  const getImage = () => {
    const node = $getRoot().getFirstChildOrThrow()
    if (!(node instanceof ImageNode)) throw new Error('Expected image')
    return node
  }
  try {
    a.editor.update(
      () => {
        $getRoot().append($createImageNode(source('a')))
      },
      { discrete: true },
    )
    applyUpdate(b.doc, encodeStateAsUpdate(a.doc))
    await Promise.resolve()
    a.editor.update(
      () => {
        getImage()
          .setSource(source('b', 100, 200))
          .setAltText('Updated alt')
      },
      { discrete: true },
    )
    b.editor.update(
      () => {
        getImage()
          .setSource(source('c', 300, 400))
          .setDisplayWidth(150)
      },
      { discrete: true },
    )
    applyUpdate(a.doc, encodeStateAsUpdate(b.doc))
    applyUpdate(b.doc, encodeStateAsUpdate(a.doc))
    await Promise.resolve()
    const read = (c: typeof a) =>
      c.editor.getEditorState().read(() => {
        const image = getImage()
        expect($getNodeByKey(image.getKey())).toBe(image)
        return {
          source: image.getSource(),
          alt: image.getAltText(),
          width: image.getDisplayWidth(),
        }
      })
    const result = read(a)
    expect(read(b)).toEqual(result)
    expect([source('b', 100, 200), source('c', 300, 400)]).toContainEqual(
      result.source,
    )
    expect(result.alt).toBe('Updated alt')
    expect(result.width).toBe(150)
    expect([...collectReferences(encodeStateAsUpdate(a.doc))]).toEqual([
      result.source.assetId,
    ])
  } finally {
    a.close()
    b.close()
  }
})

it('rejects unsupported image versions in headless package snapshots', () => {
  const { doc, editor, close } = client()
  try {
    editor.update(
      () => {
        $getRoot().append($createImageNode(source('a')))
      },
      { discrete: true },
    )
    const persisted = doc.get('root', XmlText).toDelta()[0].insert
    expect(persisted).toBeInstanceOf(XmlElement)
    ;(persisted as XmlElement).setAttribute(
      '__imageVersion',
      2 as unknown as string,
    )
    expect(() => collectReferences(encodeStateAsUpdate(doc))).toThrow(
      'requires support',
    )
  } finally {
    close()
  }
})

it('reloads edited placement metadata and source from a persisted binding snapshot', async () => {
  const original = client()
  const reloaded = client()
  try {
    original.editor.update(
      () => {
        $getRoot().append($createImageNode(source('a')))
      },
      { discrete: true },
    )
    original.editor.update(
      () => {
        const image = $getRoot().getFirstChildOrThrow()
        if (!(image instanceof ImageNode)) throw new Error('Expected image')
        image
          .setAltText('Persisted photo')
          .setDisplayWidth(321)
          .setSource(source('b', 800, 600))
      },
      { discrete: true },
    )
    const snapshot = encodeStateAsUpdate(original.doc)
    applyUpdate(reloaded.doc, snapshot)
    await Promise.resolve()
    expect(reloaded.editor.getEditorState().toJSON()).toEqual(
      original.editor.getEditorState().toJSON(),
    )
    expect(
      reloaded.editor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe('[Image: Persisted photo]')
    expect([...collectReferences(snapshot)]).toEqual([source('b').assetId])
  } finally {
    original.close()
    reloaded.close()
  }
})

it('inherits validated resizing without mutating previous editor snapshots', () => {
  const { editor, close } = client()
  try {
    editor.update(
      () => {
        const image = $createImageNode(source('a'), 'Resizable', 200)
        expect(image).toBeInstanceOf(ResizableNode)
        $getRoot().append(image)
      },
      { discrete: true },
    )
    const previous = editor.getEditorState()
    editor.update(
      () => {
        const image = $getRoot().getFirstChildOrThrow<ImageNode>()
        image.setDisplayWidth(320).setAltText('Resized')
        expect(() => image.setDisplayWidth(Infinity)).toThrow()
        expect(() => image.setDisplayWidth(16385)).toThrow()
      },
      { discrete: true },
    )
    expect(
      previous.read(() =>
        $getRoot().getFirstChildOrThrow<ImageNode>().getDisplayWidth(),
      ),
    ).toBe(200)
    expect(
      editor
        .getEditorState()
        .read(() =>
          $getRoot().getFirstChildOrThrow<ImageNode>().getDisplayWidth(),
        ),
    ).toBe(320)
  } finally {
    close()
  }
})
