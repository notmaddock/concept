import { describe, expect, it, vi } from 'vitest'
import { getDOMRangeRect } from './getDOMRangeRect'

describe('getDOMRangeRect', () => {
  it('does not jump to document top when anchorNode is rootElement', () => {
    const root = document.createElement('div')
    const p1 = document.createElement('p')
    p1.textContent = 'First line at top'
    const p2 = document.createElement('p')
    p2.textContent = 'Second line far below'
    root.appendChild(p1)
    root.appendChild(p2)
    document.body.appendChild(root)

    const p1Rect = new DOMRect(0, 10, 100, 20)
    const p2Rect = new DOMRect(0, 500, 100, 20)
    vi.spyOn(p1, 'getBoundingClientRect').mockReturnValue(p1Rect)
    vi.spyOn(p2, 'getBoundingClientRect').mockReturnValue(p2Rect)

    // Simulate selection where anchor is rootElement (e.g. multi-block selection)
    // and focusNode is in p2
    const textNode = p2.firstChild as Text
    const mockSelection = {
      anchorNode: root,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 3,
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => {
        const range = document.createRange()
        range.setStart(root, 0)
        range.setEnd(textNode, 3)
        return range
      },
    } as unknown as Selection

    const result = getDOMRangeRect(mockSelection, root)
    expect(result.top).toBe(500)
    expect(result.top).not.toBe(10)

    root.remove()
  })

  it('returns empty DOMRect if focus node is not inside rootElement', () => {
    const root = document.createElement('div')
    const outside = document.createElement('div')
    document.body.appendChild(root)
    document.body.appendChild(outside)

    const mockSelection = {
      anchorNode: root,
      anchorOffset: 0,
      focusNode: outside,
      focusOffset: 0,
      isCollapsed: true,
      rangeCount: 0,
      getRangeAt: () => null,
    } as unknown as Selection

    const result = getDOMRangeRect(mockSelection, root)
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)

    root.remove()
    outside.remove()
  })
})

it('uses the focused child boundary when both selection points are on the root', () => {
  const root = document.createElement('div')
  root.appendChild(document.createElement('p'))
  root.appendChild(document.createElement('p'))
  const rect = new DOMRect(0, 500, 100, 20)
  vi.spyOn(root.lastElementChild!, 'getBoundingClientRect').mockReturnValue(
    rect,
  )
  const selection = {
    anchorNode: root,
    anchorOffset: 0,
    focusNode: root,
    focusOffset: 2,
    isCollapsed: false,
    rangeCount: 0,
  } as unknown as Selection
  expect(getDOMRangeRect(selection, root)).toBe(rect)
})
