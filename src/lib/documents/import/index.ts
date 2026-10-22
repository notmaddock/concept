import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { Doc } from 'yjs'
import type { ImportFormat } from './formats'
import { importFormats } from './formats'
import { parseConcept, serializeConcept } from '../concept-file'
import { LocalProvider } from '../local-provider'

export async function convertImport(file: File, format: ImportFormat) {
  const definition = importFormats.find((item) => item.id === format)
  if (
    !definition?.extensions.some((extension) =>
      file.name.toLowerCase().endsWith(extension),
    )
  )
    throw new Error(`Choose a ${definition?.label ?? 'supported'} file.`)
  const content = await file.text()
  const name = file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled document'
  const editor = createEditor({
    namespace: 'document-import',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode],
    onError: (error) => {
      throw error
    },
  })
  const convert =
    format === 'markdown'
      ? (await import('./markdown')).convertMarkdown
      : format === 'html'
        ? (await import('./html')).convertHtml
        : () => {
            for (const line of content.replace(/\r\n?/g, '\n').split('\n'))
              $getRoot().append(
                $createParagraphNode().append($createTextNode(line)),
              )
          }
  const doc = new Doc()
  const provider = new LocalProvider('import', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'import',
    doc,
    docMap: new Map([['import', doc]]),
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
  try {
    editor.update(
      () => {
        $getRoot().clear()
        convert(content, editor)
        if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode())
      },
      { discrete: true },
    )
    return parseConcept(serializeConcept(name, doc))
  } finally {
    unregister()
    provider.destroy()
    binding.root.destroy(binding)
    doc.destroy()
  }
}
