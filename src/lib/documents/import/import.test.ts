import { expect, it } from 'vitest'
import { applyUpdate, Doc, XmlText } from 'yjs'
import { createEditor, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { createYjsBinding, syncYjsChangesToLexical } from '@lexical/yjs'
import { convertImport } from './index'
import type { ImportFormat } from './formats'
import { LocalProvider } from '../local-provider'
import { validateDocumentContent } from '../validate-content'
import { decodeUpdate } from '../concept-file'

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
      CodeHighlightNode,
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
  applyUpdate(
    doc,
    Uint8Array.from(atob(file.update), (character) => character.charCodeAt(0)),
  )
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

it('converts Markdown code blocks into CodeNodes', async () => {
  const { state, text } = await converted(
    '```ts\nconst greeting = "hello"\n```',
    'Code.md',
    'markdown',
  )
  expect(state.root.children.map((node) => node.type)).toEqual(['code'])
  expect(text).toContain('const greeting = "hello"')
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

it("validates and round-trips markdown task lists with checkboxes (VAL-01 triage)", async () => {
  const { file, state } = await converted(
    "- [ ] Task pending\n- [x] Task complete",
    "Tasks.md",
    "markdown",
  )
  expect(state.root.children[0].type).toBe("list")
  expect(() => validateDocumentContent(decodeUpdate(file.update))).not.toThrow()
})
