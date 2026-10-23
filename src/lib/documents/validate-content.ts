import { $getRoot, createEditor } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { createYjsBinding, syncYjsChangesToLexical } from '@lexical/yjs'
import { applyUpdate, Doc, Map as YMap, XmlText } from 'yjs'
import { LocalProvider } from './local-provider'

function validateElement(element: XmlText, root = false) {
  let followsText = false
  for (const delta of element.toDelta()) {
    const child: unknown = delta.insert
    if (typeof child === 'string') {
      if (root || !followsText) throw new Error('Unsupported document text')
    } else {
      followsText = child instanceof YMap && child.get('__type') === 'text'
      if (child instanceof XmlText) validateElement(child)
    }
  }
}

export function validateDocumentContent(update: Uint8Array) {
  const doc = new Doc()
  const root = doc.get('root', XmlText)
  const editor = createEditor({
    namespace: 'document-validation',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode],
    onError: (error) => {
      throw error
    },
  })
  const provider = new LocalProvider('validation', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'validation',
    doc,
    docMap: new Map([['validation', doc]]),
  })
  root.observeDeep((events, transaction) => {
    validateElement(root, true)
    syncYjsChangesToLexical(
      binding,
      provider,
      events,
      transaction.origin === binding,
    )
  })
  try {
    applyUpdate(doc, update)
    editor.update(() => {}, { discrete: true })
    if (
      !root.length ||
      editor.getEditorState().read(() => $getRoot().isEmpty())
    )
      throw new Error('Missing document content')
    // Importing the hydrated state also validates serialized node properties.
    editor.parseEditorState(editor.getEditorState().toJSON())
  } finally {
    provider.destroy()
    binding.root.destroy(binding)
    doc.destroy()
  }
}
