import { getDOMSelectionRangeAndPoints } from 'lexical'

export function getDOMRangeRect(
  nativeSelection: Selection,
  rootElement: HTMLElement,
): DOMRect {
  const { points, range } = getDOMSelectionRangeAndPoints(
    nativeSelection,
    rootElement,
  )
  if (points.anchorNode === rootElement || range === null) {
    let inner = rootElement
    while (inner.firstElementChild != null) {
      inner = inner.firstElementChild as HTMLElement
    }
    return inner.getBoundingClientRect()
  }
  return range.getBoundingClientRect()
}
