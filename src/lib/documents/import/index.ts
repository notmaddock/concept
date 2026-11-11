import { ImageNode } from '#/components/nova/nodes/ImageNode'
import {
  prepareHtmlImages,
  sanitizedHtml,
} from '#/components/nova/clipboard/html'
import { describeAsset } from '../assets'
import type { AssetRecord } from '../assets'
import { captureDocument } from '../references'
import type { LexicalEditor } from 'lexical'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { HorizontalRuleNode } from '@lexical/extension'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { Doc } from 'yjs'
import type { ImportFormat } from './formats'
import { importFormats } from './formats'
import { captureSnapshot } from '../working'
import { imageTransferLimits } from '../image-transfer'
import { packageLimits } from '../limits'
import { LocalProvider } from '../local-provider'

const converters: Record<
  ImportFormat,
  () => Promise<(content: string, editor: LexicalEditor) => void>
> = {
  markdown: async () => {
    // Deferred import to avoid bundling Markdown transformers during initial load
    const { convertMarkdown } = await import('./markdown')
    return convertMarkdown
  },
  html: async () => {
    // Deferred import to avoid bundling HTML import parser during initial load
    const { convertHtml } = await import('./html')
    return convertHtml
  },
  text: async () => (content) => {
    for (const line of content.replace(/\r\n?/g, '\n').split('\n'))
      $getRoot().append($createParagraphNode().append($createTextNode(line)))
  },
}

async function prepareHtmlAssets(content: string) {
  const html = sanitizedHtml(content)
  const { images } = await prepareHtmlImages(html)
  const assets: AssetRecord[] = []
  for (const image of images) {
    const descriptor = await describeAsset(image.blob)
    assets.push({ descriptor, blob: image.blob })
    image.element.setAttribute(
      'data-concept-image-source',
      JSON.stringify({
        assetId: descriptor.id,
        intrinsicWidth: image.intrinsicWidth,
        intrinsicHeight: image.intrinsicHeight,
      }),
    )
  }
  return { content: html.body.innerHTML, assets }
}

function createHeadlessImportSession() {
  const editor = createEditor({
    namespace: 'document-import',
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      HorizontalRuleNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      ImageNode,
    ],
    onError: (error) => {
      throw error
    },
  })
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
  return {
    editor,
    doc,
    cleanup() {
      unregister()
      provider.destroy()
      binding.root.destroy(binding)
      doc.destroy()
    },
  }
}

export async function convertImport(file: File, format: ImportFormat) {
  const definition = importFormats.find((item) => item.id === format)
  if (
    !definition?.extensions.some((extension) =>
      file.name.toLowerCase().endsWith(extension),
    )
  )
    throw new Error(`Choose a ${definition?.label ?? 'supported'} file.`)
  const byteLimit =
    format === 'html'
      ? imageTransferLimits.bytes * 3
      : packageLimits.documentBytes
  if (file.size > byteLimit) throw new Error('Import file is too large.')
  const raw = await file.text()
  if (raw.length > byteLimit) throw new Error('Import file is too large.')

  const { content, assets } =
    format === 'html'
      ? await prepareHtmlAssets(raw)
      : { content: raw, assets: [] }

  const name = file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled document'
  const convert = await converters[format]()
  const session = createHeadlessImportSession()
  try {
    session.editor.update(
      () => {
        $getRoot().clear()
        convert(content, session.editor)
        if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode())
      },
      { discrete: true },
    )
    if (assets.length) {
      const captured = captureDocument(session.doc, name)
      return {
        name: captured.name,
        update: captured.update,
        assets,
        requiredFeatures: [],
      }
    }
    return await captureSnapshot(name, session.doc)
  } finally {
    session.cleanup()
  }
}
