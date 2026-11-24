import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import type { Klass, LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { $isTableNode } from '@lexical/table'
import type { AssetId } from './assets'
import { documentNodes } from '#/components/nova/node-registry'
import { $createPageNode } from '#/components/nova/pages/PageNode'
import { $createImageNode, ImageNode } from '#/components/nova/nodes/ImageNode'
import { convertHtml } from './import/html'
import { convertMarkdown } from './import/markdown'
import { exportMarkdown } from './export/markdown'
import { serializeExport } from './export'
import {
  markdownTransformers,
  markdownWarnings,
  supportedTransformers,
} from './markdown-transformers'

const nodes = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  HorizontalRuleNode,
  CodeNode,
  LinkNode,
  AutoLinkNode,
  ImageNode,
]

function createTestEditor(registered: Array<Klass<LexicalNode>> = nodes) {
  return createEditor({
    namespace: 'markdown-transformers-test',
    nodes: registered,
    onError: (error) => {
      throw error
    },
  })
}

describe('markdown transformer registry', () => {
  it('preserves GFM table text, emphasis and alignment under a page wrapper', () => {
    const editor = createTestEditor(documentNodes)
    editor.update(
      () => {
        const source =
          '# Heading\n\n| **Stage** | Status |\n| --- | ---: |\n| Ready \\| review | Open |\n\n## Follow-up'
        expect(convertMarkdown(source, editor)).toEqual([])
        const root = $getRoot()
        expect(root.getChildren().map((child) => child.getType())).toEqual([
          'heading',
          'table',
          'heading',
        ])
        const page = $createPageNode()
        page.getContentNode().append(...root.getChildren())
        root.append(page)
        expect(exportMarkdown(editor)).toBe(source)
      },
      { discrete: true },
    )
  })

  it('retains merged cells and column structure in standalone HTML', async () => {
    const editor = createTestEditor(documentNodes)
    editor.update(
      () => {
        convertHtml(
          '<section data-concept-columns><div data-concept-column><h2>Left</h2></div><div data-concept-column><p>Right</p></div></section><table><tr><th scope="col">A</th><th scope="col">B</th></tr><tr><td colspan="2">Combined</td></tr></table>',
          editor,
        )
        expect($isTableNode($getRoot().getLastChild())).toBe(true)
      },
      { discrete: true },
    )
    const html = await serializeExport(editor, 'Layout', 'html')
    const standalone = new DOMParser().parseFromString(
      html.content,
      'text/html',
    )
    expect(
      standalone.querySelectorAll(
        '[data-concept-columns] > [data-concept-column]',
      ),
    ).toHaveLength(2)
    expect(standalone.querySelector('td[colspan="2"]')?.textContent).toBe(
      'Combined',
    )
    const markdown = await serializeExport(editor, 'Layout', 'markdown')
    expect(markdown.content).toContain('## Left\n\nRight')
    expect(markdown.content).toContain('| Combined |  |')
    expect(markdown.notice).toContain(
      'exports columns in reading order and flattens merged cells',
    )
  })

  it('imports a single-column GFM table with an unpiped heading', () => {
    const editor = createTestEditor(documentNodes)
    editor.update(
      () => {
        const source = 'Header\n| --- |\n| Value |'
        expect(convertMarkdown(source, editor)).toEqual([])
        expect($isTableNode($getRoot().getFirstChild())).toBe(true)
        expect(exportMarkdown(editor)).toBe('| Header |\n| --- |\n| Value |')
      },
      { discrete: true },
    )
    expect(markdownWarnings('Header\n| --- |\n| Value |', [])).toMatchObject([
      { construct: 'table' },
    ])
  })

  it('preserves all cells and literal backslashes before pipes in Markdown', () => {
    const editor = createTestEditor(documentNodes)
    editor.update(
      () => {
        convertHtml(
          '<table><tr><th>A</th></tr><tr><td>x \\| y</td><td>Extra</td></tr></table>',
          editor,
        )
        const markdown = exportMarkdown(editor)
        expect(markdown).toContain('Extra')
        convertMarkdown(markdown, editor)
        const table = $getRoot().getFirstChild()
        expect(
          $isTableNode(table) && table.getLastChild()?.getTextContent(),
        ).toContain('x \\| y')
        expect(table?.getTextContent()).toContain('Extra')
      },
      { discrete: true },
    )
  })

  it('round-trips every registered node type through one transformer set', () => {
    const editor = createTestEditor()
    const source = [
      '## Heading',
      '',
      '> Quote',
      '',
      '- Item',
      '',
      '1. First',
      '',
      '- [x] Done',
      '',
      '---',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '[Example](https://example.com)',
    ].join('\n')
    editor.update(
      () => {
        convertMarkdown(source, editor)
        const output = exportMarkdown(editor)
        expect(output).toContain('## Heading')
        expect(output).toContain('> Quote')
        expect(output).toContain('- Item')
        expect(output).toContain('1. First')
        expect(output).toContain('- [x] Done')
        expect(output).toContain('---')
        expect(output).toContain('```ts')
        expect(output).toContain('[Example](https://example.com)')
      },
      { discrete: true },
    )
  })

  it('exports images through the shared image fallback transformer', () => {
    const editor = createTestEditor()
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createImageNode(
              {
                assetId: `sha256:${'0'.repeat(64)}` as AssetId,
                intrinsicWidth: 100,
                intrinsicHeight: 100,
              },
              'Landscape',
            ),
          ),
        )
        expect(exportMarkdown(editor)).toContain('[Image: Landscape]')
      },
      { discrete: true },
    )
  })

  it('uses the same filtered transformer set for import and export', () => {
    const editor = createTestEditor()
    const transformers = supportedTransformers(editor)
    expect(transformers).toEqual(
      markdownTransformers.filter(
        (transformer) =>
          !('dependencies' in transformer) ||
          editor.hasNodes(transformer.dependencies),
      ),
    )
    expect(transformers).toContain(
      markdownTransformers.find(
        (transformer) =>
          'dependencies' in transformer &&
          transformer.dependencies.includes(CodeNode),
      ),
    )
    expect(transformers).toContain(
      markdownTransformers.find(
        (transformer) =>
          'dependencies' in transformer &&
          transformer.dependencies.includes(LinkNode),
      ),
    )
  })

  it('reports unsupported constructs instead of dropping them silently', () => {
    const editor = createTestEditor([HeadingNode])
    const transformers = supportedTransformers(editor)
    expect(
      markdownWarnings(
        '```ts\nconst answer = 42\n```\n\n[Example](https://example.com)\n\n| a | b |\n| --- | --- |',
        transformers,
      ).map((warning) => warning.construct),
    ).toEqual(['code', 'link', 'table'])
    expect(
      markdownWarnings(
        '![Alt](https://example.com/image.png)',
        supportedTransformers(createTestEditor()),
      ).map((warning) => warning.construct),
    ).toEqual(['image'])
    expect(
      markdownWarnings(
        '```ts\nconst answer = 42\n```\n\n[Example](https://example.com)',
        supportedTransformers(createTestEditor()),
      ),
    ).toEqual([])
  })
})
