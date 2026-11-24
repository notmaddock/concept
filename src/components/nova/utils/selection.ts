import { $getNodeByKey, $isElementNode, $isTextNode } from 'lexical'
import type { PointType, RangeSelection } from 'lexical'

function $isValidPoint(point: PointType) {
  const node = $getNodeByKey(point.key)
  if (!node?.isAttached() || point.offset < 0) return false
  return point.type === 'element'
    ? $isElementNode(node) && point.offset <= node.getChildrenSize()
    : $isTextNode(node) && point.offset <= node.getTextContentSize()
}

export function $isValidRange(selection: RangeSelection) {
  return $isValidPoint(selection.anchor) && $isValidPoint(selection.focus)
}
