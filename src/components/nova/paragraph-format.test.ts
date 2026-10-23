import { describe, expect, it, vi } from 'vitest'
import { $createParagraphNode, createEditor } from 'lexical'
import { $setParagraphStyle, paragraphDOM } from './paragraph-format'

describe('paragraph-format DOM decoration', () => {
  it('decorates element with cached styles without allocating new DOM elements repeatedly', () => {
    const editor = createEditor({
      dom: paragraphDOM,
    })

    const createElementSpy = vi.spyOn(document, 'createElement')

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $setParagraphStyle(
          paragraph,
          'line-height: 1.5; margin-top: 10px; margin-bottom: 20px',
        )

        const dom1 = document.createElement('p')
        paragraphDOM.$decorateDOM(paragraph, null, dom1)
        expect(dom1.style.lineHeight).toBe('1.5')
        expect(dom1.style.marginTop).toBe('10px')
        expect(dom1.style.marginBottom).toBe('20px')

        // Second call on another DOM node
        const dom2 = document.createElement('p')
        paragraphDOM.$decorateDOM(paragraph, null, dom2)
        expect(dom2.style.lineHeight).toBe('1.5')
        expect(dom2.style.marginTop).toBe('10px')
        expect(dom2.style.marginBottom).toBe('20px')
      },
      { discrete: true },
    )

    // document.createElement('span') should be cached and not called repeatedly
    const spanCalls = createElementSpy.mock.calls.filter(
      (args) => args[0] === 'span',
    )
    expect(spanCalls.length).toBeLessThanOrEqual(1)

    createElementSpy.mockRestore()
  })

  it('removes properties when paragraph style updates to empty', () => {
    const editor = createEditor({
      dom: paragraphDOM,
    })

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $setParagraphStyle(paragraph, 'line-height: 1.5')
        const dom = document.createElement('p')
        paragraphDOM.$decorateDOM(paragraph, null, dom)
        expect(dom.style.lineHeight).toBe('1.5')

        $setParagraphStyle(paragraph, '')
        paragraphDOM.$decorateDOM(paragraph, null, dom)
        expect(dom.style.lineHeight).toBe('')
      },
      { discrete: true },
    )
  })
})
