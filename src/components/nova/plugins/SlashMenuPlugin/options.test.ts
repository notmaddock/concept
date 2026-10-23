import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setCompositionKey,
  createEditor,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import type { TriggerFn } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $getParagraphStyle, $setParagraphStyle } from '../../paragraph-format'
import {
  $selectBlockOption,
  filterBlockOptions,
  getBlockOptions,
} from './options'
import { useSlashTriggerMatch } from './SlashMenuPlugin'

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

  it('removes the query node and converts the block synchronously before closing the menu', () => {
    const editor = createEditor({ nodes: [HeadingNode, QuoteNode] })
    let blockTypeWhenClosing: string | undefined
    let textWhenClosing: string | undefined

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        const textNode = $createTextNode('/h1')
        paragraph.append(textNode)
        $getRoot().append(paragraph)
        textNode.select(3, 3)

        const [queryNode] = textNode.splitText(3)
        const headingOption = getBlockOptions(editor).find(
          (option) => option.key === 'heading-1',
        )!

        $selectBlockOption(headingOption, queryNode, () => {
          const currentBlock = $getRoot().getFirstChild()!
          blockTypeWhenClosing = currentBlock.getType()
          textWhenClosing = currentBlock.getTextContent()
        })
      },
      { discrete: true },
    )

    expect(blockTypeWhenClosing).toBe('heading')
    expect(textWhenClosing).toBe('')
    editor.read('latest', () => {
      const block = $getRoot().getFirstChild()!
      const selection = $getSelection()
      expect(block.getType()).toBe('heading')
      expect(block.getTextContent()).toBe('')
      expect($isRangeSelection(selection)).toBe(true)
    })
  })

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

  it('suppresses slash trigger matching during IME composition and resumes after composition ends', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const editor = createEditor({ nodes: [HeadingNode, QuoteNode] })
    let capturedTrigger: TriggerFn | undefined

    function TriggerHarness() {
      capturedTrigger = useSlashTriggerMatch()
      return null
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(() => {
        root.render(createElement(TriggerHarness))
      })
      if (!capturedTrigger) throw new Error('Expected trigger function')

      // Bare '/' and multi-word queries match when not composing
      expect(capturedTrigger('/', editor)).toEqual({
        leadOffset: 0,
        matchingString: '',
        replaceableString: '/',
      })
      expect(capturedTrigger('/heading 1', editor)).toEqual({
        leadOffset: 0,
        matchingString: 'heading 1',
        replaceableString: '/heading 1',
      })

      // Simulate active IME composition on a text node
      editor.update(
        () => {
          const paragraph = $createParagraphNode()
          const textNode = $createTextNode('/h1')
          paragraph.append(textNode)
          $getRoot().append(paragraph)
          $setCompositionKey(textNode.getKey())
        },
        { discrete: true },
      )
      expect(editor.isComposing()).toBe(true)
      expect(capturedTrigger('/', editor)).toBeNull()
      expect(capturedTrigger('/h1', editor)).toBeNull()

      // Simulate compositionend
      editor.update(
        () => {
          $setCompositionKey(null)
        },
        { discrete: true },
      )
      expect(editor.isComposing()).toBe(false)
      expect(capturedTrigger('/h1', editor)).toEqual({
        leadOffset: 0,
        matchingString: 'h1',
        replaceableString: '/h1',
      })
    } finally {
      await act(() => root.unmount())
      vi.unstubAllGlobals()
    }
  })
})
