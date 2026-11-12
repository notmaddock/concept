import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import { CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import type { AssetId } from './assets'
import { $createImageNode, ImageNode } from '#/components/nova/nodes/ImageNode'
import { convertMarkdown } from './import/markdown'
import { exportMarkdown } from './export/markdown'
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

function createTestEditor(registered = nodes) {
  return createEditor({
    namespace: 'markdown-transformers-test',
    nodes: registered,
    onError: (error) => {
      throw error
    },
  })
}

describe('markdown transformer registry', () => {
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
