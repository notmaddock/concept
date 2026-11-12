import { describe, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list'
import {
  $createHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/extension'
import {
  $createCodeHighlightNode,
  $createCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code'
import { $createLinkNode, LinkNode } from '@lexical/link'
import { downloadExport, exportFilename, serializeExport } from './index'

function fixture() {
  const editor = createEditor({
    namespace: 'export-test',
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      HorizontalRuleNode,
      CodeNode,
      LinkNode,
    ],
    onError: (error) => {
      throw error
    },
  })
  editor.update(
    () => {
      $getRoot().append(
        $createHeadingNode('h2').append($createTextNode('Café 日本語 👋')),
        $createParagraphNode().append(
          $createTextNode('<script>alert("x")</script>').toggleFormat('bold'),
        ),
        $createListNode('check').append(
          $createListItemNode(true).append($createTextNode('Done')),
        ),
        $createHorizontalRuleNode(),
      )
    },
    { discrete: true },
  )
  return editor
}

describe('local export', () => {
  it('exports complete Unicode text without changing editor state', async () => {
    const editor = fixture()
    const before = JSON.stringify(editor.getEditorState())
    const file = await serializeExport(editor, 'Notes', 'text')
    expect(file.content).toContain('Café 日本語 👋')
    expect(file.content).toContain('<script>')
    expect(file.content).toContain('Done')
    expect(JSON.stringify(editor.getEditorState())).toBe(before)
  })
  it('exports headings, emphasis, checklists and horizontal rules as Markdown', async () => {
    const file = await serializeExport(fixture(), 'Notes', 'markdown')
    expect(file.content).toContain('## Café 日本語 👋')
    expect(file.content).toContain('**')
    expect(file.content).toContain('[x] Done')
    expect(file.content).toContain('---')
  })
  it('exports code nodes as fenced Markdown with their language', async () => {
    const editor = createEditor({
      namespace: 'export-code-test',
      nodes: [CodeNode],
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append(
          $createCodeNode('ts').append($createTextNode('const answer = 42')),
        )
      },
      { discrete: true },
    )
    const file = await serializeExport(editor, 'Snippet', 'markdown')
    expect(file.content).toContain('```ts')
    expect(file.content).toContain('const answer = 42')
  })
  it('keeps only token and language classes in exported HTML', async () => {
    const editor = createEditor({
      namespace: 'export-class-test',
      nodes: [CodeNode, CodeHighlightNode],
      theme: {
        paragraph: 'mb-2',
        code: 'mb-2',
        codeHighlight: { keyword: 'token keyword language-js' },
      },
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Text')),
          $createCodeNode('js').append(
            $createCodeHighlightNode('const', 'keyword'),
          ),
        )
      },
      { discrete: true },
    )
    const file = await serializeExport(editor, 'Code', 'html')
    const document = new DOMParser().parseFromString(file.content, 'text/html')
    expect(document.querySelector('p')?.hasAttribute('class')).toBe(false)
    expect(document.querySelector('pre')?.className).toContain('language-js')
    expect(document.querySelector('.token')?.className).toBe(
      'token keyword language-js',
    )
  })
  it('exports links to Markdown and HTML with external attributes', async () => {
    const editor = createEditor({
      namespace: 'export-link-test',
      nodes: [LinkNode],
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createLinkNode('https://example.com', {
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
            }).append($createTextNode('Example')),
            $createLinkNode('example.com').append($createTextNode('Bare Link')),
          ),
        )
      },
      { discrete: true },
    )
    const markdown = await serializeExport(editor, 'Links', 'markdown')
    expect(markdown.content).toContain('[Example](https://example.com)')
    const html = await serializeExport(editor, 'Links', 'html')
    const document = new DOMParser().parseFromString(html.content, 'text/html')
    const anchors = Array.from(document.querySelectorAll('a'))
    expect(anchors[0]?.getAttribute('href')).toBe('https://example.com')
    expect(anchors[0]?.getAttribute('target')).toBe('_blank')
    expect(anchors[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(anchors[1]?.getAttribute('href')).toBe('https://example.com')
    expect(anchors[1]?.getAttribute('target')).toBe('_blank')
    expect(anchors[1]?.getAttribute('rel')).toBe('noopener noreferrer nofollow')
  })

  it('creates standalone HTML with escaped content and title', async () => {
    const file = await serializeExport(
      fixture(),
      '</title><script>bad()</script>',
      'html',
    )
    const html = new DOMParser().parseFromString(file.content, 'text/html')
    expect(html.title).toBe('</title><script>bad()</script>')
    expect(html.querySelector('script')).toBeNull()
    expect(html.querySelector('h2')?.textContent).toBe('Café 日本語 👋')
    expect(html.querySelector('hr')).not.toBeNull()
    expect(
      html.querySelector('ul[data-lexical-list-type="check"]'),
    ).not.toBeNull()
    expect(html.querySelector('li[aria-checked="true"]')).not.toBeNull()
    expect(html.querySelector('style')?.textContent).toContain('@page')
    expect(html.querySelector('[class]')).toBeNull()
    expect(html.querySelector('[src],link')).toBeNull()
    expect(
      html.querySelector('meta[http-equiv]')?.getAttribute('content'),
    ).toContain("default-src 'none'")
  })
  it('downloads a Blob with a safe filename and releases its URL', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:export')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('a_b.txt')
        expect(this.isConnected).toBe(true)
      })
    try {
      downloadExport('a/b', {
        content: 'hello',
        extension: 'txt',
        mime: 'text/plain',
      })
      expect(create).toHaveBeenCalledWith(expect.any(Blob))
      expect(click).toHaveBeenCalledOnce()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:export')
      expect(exportFilename('... ', 'md')).toBe('Untitled document.md')
    } finally {
      click.mockRestore()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

it('captures image HTML before resolving bytes and preserves text/Markdown fallbacks', async () => {
  const { ImageNode, $createImageNode } =
    await import('#/components/nova/nodes/ImageNode')
  const { assetId } = await import('../assets')
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 20
      naturalHeight = 10
      src = ''
      decoding = ''
      decode = async () => {}
    },
  )
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:temporary',
    revokeObjectURL: () => {},
  })
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: 'image/png',
  })
  const id = await assetId(await blob.arrayBuffer())
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error
    },
  })
  editor.update(
    () => {
      $getRoot().append(
        $createImageNode(
          { assetId: id, intrinsicWidth: 20, intrinsicHeight: 10 },
          'Landscape',
          200,
        ),
      )
    },
    { discrete: true },
  )
  let resolve!: () => void
  const wait = new Promise<void>((done) => {
    resolve = done
  })
  const resolver = {
    resolve: async () => {
      await wait
      return { state: 'available' as const, blob }
    },
    getState: () => ({ state: 'available' as const, blob }),
    subscribe: () => () => {},
    retry: async () => {},
    close: () => {},
  }
  const output = serializeExport(editor, 'Images', 'html', resolver)
  await new Promise((done) => setTimeout(done, 0))
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('Later edit')))
    },
    { discrete: true },
  )
  resolve()
  const html = (await output).content
  expect(html).toContain('data:image/png;base64,')
  expect(html).toContain('Landscape')
  expect(html).not.toContain('Later edit')
  expect(html).not.toContain('blob:')
  editor.update(
    () => {
      $getRoot().append(
        $createImageNode(
          { assetId: id, intrinsicWidth: 20, intrinsicHeight: 10 },
          'Landscape',
        ),
      )
    },
    { discrete: true },
  )
  expect((await serializeExport(editor, 'Images', 'text')).content).toContain(
    '[Image: Landscape]',
  )
  const markdown = await serializeExport(editor, 'Images', 'markdown')
  expect(markdown.content).toContain('[Image: Landscape]')
  expect(markdown.notice).toContain('alt text')
  await expect(serializeExport(editor, 'Images', 'html')).rejects.toThrow(
    'unavailable',
  )
  vi.unstubAllGlobals()
})
