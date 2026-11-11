import { expect, it } from 'vitest'
import { applyUpdate, Doc, XmlText } from 'yjs'
import { createEditor, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ImageNode } from '#/components/nova/nodes/ImageNode'
import { createYjsBinding, syncYjsChangesToLexical } from '@lexical/yjs'
import { convertImport } from './index'
import type { ImportFormat } from './formats'
import { LocalProvider } from '../local-provider'

async function converted(
  content: string,
  filename: string,
  format: ImportFormat,
) {
  const file = await convertImport(
    { name: filename, text: async () => content } as File,
    format,
  )
  const doc = new Doc()
  const root = doc.get('root', XmlText)
  const editor = createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      HorizontalRuleNode,
      CodeNode,
      LinkNode,
      AutoLinkNode,
      ImageNode,
    ],
    onError: (error) => {
      throw error
    },
  })
  const provider = new LocalProvider('test', doc, {
    whenSynced: Promise.resolve(),
    destroy: async () => {},
  })
  const binding = createYjsBinding({
    editor,
    id: 'test',
    doc,
    docMap: new Map([['test', doc]]),
  })
  root.observeDeep((events, transaction) =>
    syncYjsChangesToLexical(
      binding,
      provider,
      events,
      transaction.origin === binding,
    ),
  )
  applyUpdate(doc, file.update)
  await Promise.resolve()
  const state = editor.getEditorState().toJSON()
  const text = editor.getEditorState().read(() => $getRoot().getTextContent())
  provider.destroy()
  binding.root.destroy(binding)
  doc.destroy()
  return { file, state, text }
}

it('converts Markdown formatting into content that survives the collaboration format', async () => {
  const { file, state, text } = await converted(
    '# Café 日本語\n\n**Bold**\n\n- [x] Done\n\n---',
    'Notes.MD',
    'markdown',
  )
  expect(file.name).toBe('Notes')
  expect(state.root.children.map((node) => node.type)).toEqual([
    'heading',
    'paragraph',
    'list',
    'horizontalrule',
  ])
  expect(text).toContain('Café 日本語')
  expect(text).toContain('Done')
  expect(JSON.stringify(state)).toContain('"format":1')
})

it('converts HTML headings, lists and emphasis while discarding executable content', async () => {
  const { state, text } = await converted(
    '<h2>Heading</h2><p><strong>Bold</strong></p><ul><li>Item</li></ul><script>bad()</script><style>bad</style>',
    'Page.html',
    'html',
  )
  expect(state.root.children.map((node) => node.type)).toEqual([
    'heading',
    'paragraph',
    'list',
  ])
  expect(text).toContain('Bold')
  expect(text).not.toContain('bad')
})

it('preserves plain text literally, including empty lines and Unicode', async () => {
  const { text, state } = await converted(
    '<b>Hello</b>\r\n\r\n日本語',
    'Text.txt',
    'text',
  )
  expect(text).toBe('<b>Hello</b>\n\n\n\n日本語')
  expect(state.root.children).toHaveLength(3)
})

it('creates an editable paragraph for empty files and rejects the wrong extension', async () => {
  expect(
    (await converted('', 'Empty.txt', 'text')).state.root.children,
  ).toHaveLength(1)
  await expect(
    convertImport({ name: 'document.concept' } as File, 'markdown'),
  ).rejects.toThrow('Choose a Markdown file.')
})

it('rejects oversized imports before reading their payload', async () => {
  const { packageLimits } = await import('../limits')
  let read = false
  await expect(
    convertImport(
      {
        name: 'huge.txt',
        size: packageLimits.documentBytes + 1,
        text: async () => {
          read = true
          return 'ignored'
        },
      } as File,
      'text',
    ),
  ).rejects.toThrow('Import file is too large')
  expect(read).toBe(false)
})

it('replaces unsupported or malformed embedded images with text fallbacks without failing import', async () => {
  const { text } = await converted(
    '<p>Intro</p><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="Diagram"><img src="data:image/png;base64,***invalid***" alt="Corrupt"><img src="data:image/unsupported;base64,1234"><p>Outro</p>',
    'Document.html',
    'html',
  )
  expect(text).toContain('Intro')
  expect(text).toContain('[Image: Diagram]')
  expect(text).toContain('[Image: Corrupt]')
  expect(text).toContain('[Image]')
  expect(text).toContain('Outro')
})

it('normalizes RFC 2045 line-wrapped base64 images during HTML import', async () => {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const wrapped = `data:image/png;base64,\r\n  ${base64.slice(0, 30)}\r\n  ${base64.slice(30, 60)}\r\n  ${base64.slice(60)}\r\n`
  const originalImage = globalThis.Image
  try {
    globalThis.Image = class {
      src = ''
      naturalWidth = 1
      naturalHeight = 1
      decode = async () => {}
    } as unknown as typeof Image

    const { file, state } = await converted(
      `<p>Before</p><img src="${wrapped}" alt="Pixel"><p>After</p>`,
      'Wrapped.html',
      'html',
    )
    expect(file.assets).toHaveLength(1)
    expect(file.assets[0].descriptor.mediaType).toBe('image/png')
    expect(state.root.children.map((node) => node.type)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ])
  } finally {
    globalThis.Image = originalImage
  }
})

it('imports fenced Markdown as a code node with its language', async () => {
  const { state, text } = await converted(
    '```ts\nconst answer = 42\n```',
    'Snippet.md',
    'markdown',
  )
  expect(state.root.children.map((node) => node.type)).toEqual(['code'])
  expect(state.root.children[0]).toMatchObject({ language: 'ts' })
  expect(text).toContain('const answer = 42')
})

it('round-trips Markdown links through the collaboration format', async () => {
  const { state, text } = await converted(
    '# Links\n\n[Example](https://example.com)',
    'Links.md',
    'markdown',
  )
  expect(text).toContain('Example')
  const paragraph = state.root.children[1] as unknown as {
    children: Array<Record<string, unknown>>
  }
  expect(paragraph.children[0]).toMatchObject({
    type: 'link',
    url: 'https://example.com',
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
  })
})

it('imports HTML anchors and applies the external link policy', async () => {
  const { state } = await converted(
    '<p><a href="https://example.com">Example</a></p>',
    'Links.html',
    'html',
  )
  const paragraph = state.root.children[0] as unknown as {
    children: Array<Record<string, unknown>>
  }
  expect(paragraph.children[0]).toMatchObject({
    type: 'link',
    url: 'https://example.com',
    target: '_blank',
  })
})

it('drops disallowed link protocols while preserving their text', async () => {
  const { state, text } = await converted(
    '[Bad](data:text/html;base64,PHNjcmlwdD4=)',
    'Bad.md',
    'markdown',
  )
  expect(text).toContain('Bad')
  expect(JSON.stringify(state)).not.toContain('data:text/html')
})

it('imports every registry-backed markdown node type', async () => {
  const { state } = await converted(
    '# Heading\n\n> Quote\n\n- Item\n\n1. First\n\n- [x] Done\n\n---\n\n```ts\nconst answer = 42\n```\n\n[Example](https://example.com)',
    'Everything.md',
    'markdown',
  )
  expect(state.root.children.map((node) => node.type)).toEqual([
    'heading',
    'quote',
    'list',
    'list',
    'list',
    'horizontalrule',
    'code',
    'paragraph',
  ])
})
