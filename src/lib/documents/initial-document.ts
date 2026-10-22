import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { LocalProvider } from './local-provider'

let initialUpdate: Uint8Array | undefined

export function initializeDocument(doc: Doc) {
  if (doc.get('root', XmlText).length !== 0) return
  if (!initialUpdate) {
    const seed = new Doc()
    // Every tab must insert the same CRDT structs, rather than competing paragraphs.
    seed.clientID = 0
    const editor = createEditor({
      namespace: 'document-seed',
      onError: (error) => {
        throw error
      },
    })
    const provider = new LocalProvider('seed', seed, {
      whenSynced: Promise.resolve(),
      destroy: async () => {},
    })
    const binding = createYjsBinding({
      editor,
      id: 'seed',
      doc: seed,
      docMap: new Map([['seed', seed]]),
    })
    const unregister = editor.registerUpdateListener(
      ({
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      }) => {
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        )
      },
    )
    editor.update(
      () => {
        $getRoot().append($createParagraphNode())
      },
      { discrete: true },
    )
    initialUpdate = encodeStateAsUpdate(seed)
    unregister()
    provider.destroy()
    seed.destroy()
  }
  applyUpdate(doc, initialUpdate)
}
