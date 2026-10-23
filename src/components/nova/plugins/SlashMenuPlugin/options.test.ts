import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $getParagraphStyle, $setParagraphStyle } from '../../paragraph-format'
import { filterBlockOptions, getBlockOptions } from './options'

describe('slash block conversion', () => {
  it.each(['text', 'heading-1', 'heading-2', 'heading-3', 'quote'])(
    'preserves paragraph formatting when selecting %s',
    (key) => {
      const editor = createEditor({ nodes: [HeadingNode, QuoteNode] })
      editor.update(
        () => {
          const paragraph = $createParagraphNode()
            .setDirection('rtl')
            .setFormat('right')
            .setIndent(2)
          $setParagraphStyle(paragraph, 'line-height: 2; margin-top: 12pt;')
          paragraph.append($createTextNode('Keep this text'))
          $getRoot().append(paragraph)
          paragraph.selectEnd()
          getBlockOptions(editor)
            .find((option) => option.key === key)!
            .onSelect()
        },
        { discrete: true },
      )
      editor.read('latest', () => {
        const block = $getRoot().getFirstChild()!
        expect($isElementNode(block)).toBe(true)
        if (!$isElementNode(block)) throw new Error('Expected a block')
        expect(block.getTextContent()).toBe('Keep this text')
        expect(block.getDirection()).toBe('rtl')
        expect(block.getFormatType()).toBe('right')
        expect(block.getIndent()).toBe(2)
        expect($getParagraphStyle(block)).toBe(
          'line-height: 2; margin-top: 12pt;',
        )
      })
    },
  )

  it.each(['/[', '/*', '/(', '[', '*', '(', '+', '?', '\\'])(
    'filters options safely without throwing SyntaxError on regex metacharacter query %s',
    (query) => {
      const editor = createEditor({ nodes: [HeadingNode, QuoteNode] })
      const baseOptions = getBlockOptions(editor)

      expect(() => filterBlockOptions(baseOptions, query)).not.toThrow()
      expect(filterBlockOptions(baseOptions, query)).toEqual([])
    },
  )

  it('filters options case-insensitively by title and keywords', () => {
    const editor = createEditor({ nodes: [HeadingNode, QuoteNode] })
    const baseOptions = getBlockOptions(editor)

    expect(filterBlockOptions(baseOptions, null)).toEqual(baseOptions)
    expect(filterBlockOptions(baseOptions, '')).toEqual(baseOptions)
    expect(
      filterBlockOptions(baseOptions, 'HEADING 1').map((option) => option.key),
    ).toEqual(['heading-1'])
    expect(
      filterBlockOptions(baseOptions, 'TODO').map((option) => option.key),
    ).toEqual(['list-checked'])
  })
})
