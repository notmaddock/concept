// @vitest-environment node
import { expect, it } from 'vitest'
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  createEditor,
  DecoratorNode,
} from 'lexical'
import type { NodeKey } from 'lexical'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { Doc, encodeStateAsUpdate } from 'yjs'
import { LocalProvider } from './local-provider'
import {
  assetReferenceField,
  captureDocument,
  collectReferences,
  registerAssetReferenceCollector,
} from './references'
import type { AssetId } from './assets'

class AttachmentNode extends DecoratorNode<null> {
  __assetId: string
  static getType() {
    return 'test-attachment'
  }
  static clone(node: AttachmentNode) {
    return new AttachmentNode(node.__assetId, node.__key)
  }
  constructor(id = '', key?: NodeKey) {
    super(key)
    this.__assetId = id
  }
  createDOM(): HTMLElement {
    throw new Error('Reference discovery must never mount an editor')
  }
  updateDOM() {
    return false
  }
  decorate() {
    return null
  }
}

it('discovers typed asset fields from actual Lexical binding-generated snapshots without mounting an editor', () => {
  const id = `sha256:${'a'.repeat(64)}` as AssetId
  const doc = new Doc()
  const editor = createEditor({
    namespace: 'reference-contract',
    nodes: [AttachmentNode],
    onError: (error) => {
      throw error
    },
  })
  const provider = new LocalProvider('reference-contract', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'reference-contract',
    doc,
    docMap: new Map([['reference-contract', doc]]),
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
  const unregisterCollector = registerAssetReferenceCollector(
    'test-attachment',
    (node) => assetReferenceField(node, '__assetId'),
  )
  try {
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode(`Not a reference: ${id}`),
          ),
          new AttachmentNode(id),
        )
      },
      { discrete: true },
    )
    const captured = captureDocument(doc, 'Frozen')
    expect([...captured.requiredAssets]).toEqual([id])
    editor.update(
      () => {
        $getRoot().clear().append($createParagraphNode())
      },
      { discrete: true },
    )
    expect([...collectReferences(captured.update)]).toEqual([id])
    expect([...collectReferences(encodeStateAsUpdate(doc))]).toEqual([])
    unregisterCollector()
    expect(() => collectReferences(captured.update)).toThrow('requires support')
  } finally {
    unregisterCollector()
    unregister()
    provider.destroy()
    doc.destroy()
  }
})
