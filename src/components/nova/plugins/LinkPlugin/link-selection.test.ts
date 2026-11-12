import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from 'lexical'
import { $createAutoLinkNode, AutoLinkNode } from '@lexical/link'
import { $findLinkNode } from './link-selection'

function createTestEditor() {
  return createEditor({
    namespace: 'link-selection-test',
    nodes: [AutoLinkNode],
    onError: (error) => {
      throw error
    },
  })
}

describe('link selection', () => {
  it('finds the autolink around the caret', () => {
    const editor = createTestEditor()
    editor.update(
      () => {
        const auto = $createAutoLinkNode('https://example.com')
        auto.append($createTextNode('https://example.com'))
        $getRoot().append($createParagraphNode().append(auto))
        auto.selectEnd()
        expect($findLinkNode($getSelection())).toBe(auto)
      },
      { discrete: true },
    )
  })

  it('ignores autolinks that were unlinked', () => {
    const editor = createTestEditor()
    editor.update(
      () => {
        const auto = $createAutoLinkNode('https://example.com')
        auto.append($createTextNode('https://example.com'))
        $getRoot().append($createParagraphNode().append(auto))
        auto.selectEnd()
        auto.setIsUnlinked(true)
        expect($findLinkNode($getSelection())).toBeNull()
      },
      { discrete: true },
    )
  })
})
