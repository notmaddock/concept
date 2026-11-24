import { $createLinkNode, LinkNode } from '@lexical/link'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { expect, it } from 'vitest'
import { $findDocumentMatches, $replaceDocumentMatch } from './document-matches'

it('finds literal matches across inline formatting and keeps block boundaries', () => {
  const editor = createEditor({ nodes: [LinkNode] })
  editor.update(
    () => {
      const first = $createTextNode('a.b a').toggleFormat('bold')
      const last = $createTextNode('.B').toggleFormat('italic')
      $getRoot().append(
        $createParagraphNode().append(
          first,
          $createLinkNode('https://example.com').append(last),
        ),
        $createParagraphNode().append(
          $createTextNode('a'),
          $createLineBreakNode(),
          $createTextNode('.b'),
        ),
      )
      const matches = $findDocumentMatches('a.b', false)
      expect(matches).toHaveLength(2)
      expect(matches[1]).toEqual({
        start: { key: first.getKey(), offset: 4 },
        end: { key: last.getKey(), offset: 2 },
      })
      expect($findDocumentMatches('a.b', true)).toHaveLength(1)
      expect($findDocumentMatches('b a', false)).toHaveLength(1)
      expect($findDocumentMatches('B a', true)).toHaveLength(0)
      expect($findDocumentMatches('', false)).toEqual([])
      for (const match of matches.reverse())
        $replaceDocumentMatch(match, 'match')
      expect($getRoot().getFirstChild()?.getTextContent()).toBe('match match')
      expect($getRoot().getLastChild()?.getTextContent()).toBe('a\n.b')
    },
    { discrete: true },
  )
})
