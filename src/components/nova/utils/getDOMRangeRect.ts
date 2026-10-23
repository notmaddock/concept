import { getDOMSelectionRangeAndPoints } from 'lexical'

export function getDOMRangeRect(
  nativeSelection: Selection,
  rootElement: HTMLElement,
): DOMRect {
  const { points, range } = getDOMSelectionRangeAndPoints(
    nativeSelection,
    rootElement,
  )
  if (range && points.anchorNode !== rootElement) {
    return range.getBoundingClientRect()
  }
  const focusNode = nativeSelection.focusNode
  if (focusNode) {
    const element =
      focusNode instanceof HTMLElement ? focusNode : focusNode.parentElement
    if (element && rootElement.contains(element)) {
      return element.getBoundingClientRect()
    }
  }
  return new DOMRect(0, 0, 0, 0)
}
