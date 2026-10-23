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
import { downloadExport, exportFilename, serializeExport } from './index'

function fixture() {
  const editor = createEditor({
    namespace: 'export-test',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode],
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
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:export')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    expect(new URL('https://example.com').hostname).toBe('example.com')
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
