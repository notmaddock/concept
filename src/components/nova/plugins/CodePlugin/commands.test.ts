import { $createCodeNode, CodeNode } from '@lexical/code'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  createEditor,
} from 'lexical'
import { describe, expect, it } from 'vitest'
import { $exitCodeBlockOnEnter, $insertCodeBlock } from './commands'

function editorWithCode(lineBreaks: number) {
  const editor = createEditor({
    namespace: 'code-commands-test',
    nodes: [CodeNode],
    onError: (error) => {
      throw error
    },
  })
  editor.update(
    () => {
      const code = $createCodeNode()
      code.append($createTextNode('const x = 1'))
      for (let index = 0; index < lineBreaks; index++)
        code.append($createLineBreakNode())
      $getRoot().append(code)
      code.select(code.getChildrenSize(), code.getChildrenSize())
    },
    { discrete: true },
  )
  return editor
}

describe('code block commands', () => {
  it('exits a code block after two trailing empty lines', () => {
    const editor = editorWithCode(2)
    editor.update(
      () => {
        expect($exitCodeBlockOnEnter()).toBe(true)
      },
      { discrete: true },
    )
    expect(
      editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ),
    ).toEqual(['code', 'paragraph'])
  })

  it('keeps the code block when the caret is not after two empty lines', () => {
    const editor = editorWithCode(1)
    editor.update(
      () => {
        expect($exitCodeBlockOnEnter()).toBe(false)
      },
      { discrete: true },
    )
    expect(
      editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ),
    ).toEqual(['code'])
  })

  it('merges a multi-paragraph selection into one code block', () => {
    const editor = createEditor({
      namespace: 'code-insert-test',
      nodes: [CodeNode],
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        const first = $createParagraphNode().append($createTextNode('first'))
        const second = $createParagraphNode().append($createTextNode('second'))
        $getRoot().append(first, second)
        const selection = $createRangeSelection()
        selection.anchor.set(first.getKey(), 0, 'element')
        selection.focus.set(
          second.getKey(),
          second.getChildrenSize(),
          'element',
        )
        $setSelection(selection)
        $insertCodeBlock()
      },
      { discrete: true },
    )
    editor.getEditorState().read(() => {
      const [code] = $getRoot().getChildren()
      expect(code.getType()).toBe('code')
      expect(code.getTextContent()).toBe('first\nsecond')
    })
  })
})
