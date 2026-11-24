import {
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
} from 'lexical'
import type { LexicalNode, NodeKey, TextNode } from 'lexical'

export type MatchPoint = { key: NodeKey; offset: number }
export type DocumentMatch = { start: MatchPoint; end: MatchPoint }

export function $findDocumentMatches(query: string, matchCase: boolean) {
  if (!query) return []
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    matchCase ? 'gu' : 'giu',
  )
  const matches: DocumentMatch[] = []
  let text = ''
  let segments: { key: NodeKey; start: number; end: number }[] = []

  const flush = () => {
    let cursor = 0
    for (const match of text.matchAll(pattern)) {
      const begin = match.index
      const finish = begin + match[0].length
      while (segments[cursor].end <= begin) cursor++
      const first = segments[cursor]
      while (segments[cursor].end < finish) cursor++
      const last = segments[cursor]
      matches.push({
        start: { key: first.key, offset: begin - first.start },
        end: { key: last.key, offset: finish - last.start },
      })
    }
    segments = []
    text = ''
  }

  function append(node: TextNode) {
    const content = node.getTextContent()
    if (!content) return
    const start = text.length
    text += content
    segments.push({ key: node.getKey(), start, end: text.length })
  }

  function visit(node: LexicalNode) {
    if ($isTextNode(node) && !node.isToken() && !node.isSegmented()) {
      append(node)
    } else if ($isElementNode(node) && node.isInline()) {
      for (const child of node.getChildren()) visit(child)
    } else {
      flush()
      if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child)
        flush()
      }
    }
  }

  visit($getRoot())
  return matches
}

export function $replaceDocumentMatch(
  match: DocumentMatch,
  replacement: string,
) {
  const selection = $createRangeSelection()
  selection.anchor.set(match.start.key, match.start.offset, 'text')
  selection.focus.set(match.end.key, match.end.offset, 'text')
  $setSelection(selection)
  selection.insertText(replacement)
}
