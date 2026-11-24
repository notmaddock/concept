import { buildEditorFromExtensions } from '@lexical/extension'
import { $generateJSONFromSelectedNodes } from '@lexical/clipboard'
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import type { Transformer } from '@lexical/markdown'
import { $createHeadingNode, RichTextExtension } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  defineExtension,
  DELETE_CHARACTER_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical'
import type { LexicalEditor, NodeKey } from 'lexical'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizedHtml } from '../clipboard/html'
import { $isPageBreakNode } from '../pages/PageBreakNode'
import {
  INSERT_PAGE_BREAK,
  PageBreakExtension,
} from '../pages/PageBreakExtension'
import { $isColumnLayoutNode, $isColumnNode } from './ColumnLayoutNode'
import { createColumnLayoutMarkdown } from './column-exports'
import { ColumnLayoutExtension } from './column-layout'
import { SET_COLUMN_LAYOUT_COMMAND } from './commands'
import type { ColumnCount } from './commands'

const testExtension = defineExtension({
  name: 'test-columns',
  dependencies: [RichTextExtension, ColumnLayoutExtension, PageBreakExtension],
})

const transformers: Transformer[] = [
  createColumnLayoutMarkdown(() => transformers),
  ...TRANSFORMERS,
]

function $paragraph(text: string) {
  return $createParagraphNode().append($createTextNode(text))
}

function $getLayout() {
  const layout = $getRoot().getChildren().find($isColumnLayoutNode)
  if (!layout) throw new Error('Expected a column layout')
  return layout
}

function $getColumns() {
  return $getLayout().getChildren().filter($isColumnNode)
}

function $selectionKey() {
  const selection = $getSelection()
  return $isRangeSelection(selection) ? selection.anchor.key : undefined
}

function setLayout(editor: LexicalEditor, count: ColumnCount) {
  editor.update(
    () => editor.dispatchCommand(SET_COLUMN_LAYOUT_COMMAND, count),
    {
      discrete: true,
    },
  )
}

const cleanups: Array<() => void> = []

function mountEditor() {
  const editor = buildEditorFromExtensions(testExtension)
  const root = document.createElement('div')
  document.body.append(root)
  editor.setRootElement(root)
  cleanups.push(() => {
    editor.dispose()
    root.remove()
  })
  return { editor, root }
}

afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
})

describe('column layouts', () => {
  it('inserts a section at the caret and lets Tab move across and out of it', () => {
    const { editor, root } = mountEditor()
    editor.update(
      () => {
        const text = $createTextNode('BeforeAfter')
        $getRoot().clear().append($createParagraphNode().append(text))
        text.select(6, 6)
        editor.dispatchCommand(SET_COLUMN_LAYOUT_COMMAND, 2)
      },
      { discrete: true },
    )

    editor.read(() => {
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ).toEqual(['paragraph', 'column-layout', 'paragraph'])
      expect($getRoot().getFirstChild()?.getTextContent()).toBe('Before')
      expect($getRoot().getLastChild()?.getTextContent()).toBe('After')
      expect($selectionKey()).toBe($getColumns()[0].getFirstChild()?.getKey())
    })
    expect(root.querySelectorAll('[data-concept-column]')).toHaveLength(2)

    editor.update(
      () => {
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          cancelable: true,
        })
        expect(editor.dispatchCommand(KEY_TAB_COMMAND, event)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
        expect($selectionKey()).toBe($getColumns()[1].getFirstChild()?.getKey())
        editor.dispatchCommand(KEY_TAB_COMMAND, event)
        expect($selectionKey()).toBe($getRoot().getLastDescendant()?.getKey())
      },
      { discrete: true },
    )
  })

  it('moves selected blocks without changing their formatting or pulling in the next heading', () => {
    const { editor } = mountEditor()
    editor.update(
      () => {
        const title = $createHeadingNode('h2').append(
          $createTextNode('Heading'),
        )
        const body = $paragraph('Body')
        const following = $createHeadingNode('h2').append(
          $createTextNode('Another section'),
        )
        $getRoot().clear().append(title, body, following)
        const selection = title.selectStart()
        selection.focus.set(following.getKey(), 0, 'element')
        editor.dispatchCommand(SET_COLUMN_LAYOUT_COMMAND, 2)
      },
      { discrete: true },
    )

    editor.read(() => {
      expect($getColumns().map((column) => column.getTextContent())).toEqual([
        'Heading',
        'Body',
      ])
      expect($getColumns()[0].getFirstChild()?.getType()).toBe('heading')
      expect($getRoot().getLastChild()?.getTextContent()).toBe(
        'Another section',
      )
      expect($convertToMarkdownString(transformers)).toBe(
        '## Heading\n\nBody\n\n## Another section',
      )
    })
  })

  it('merges extra columns and unwraps them in reading order without dropping their text', () => {
    const { editor } = mountEditor()
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    setLayout(editor, 3)
    let textKey: NodeKey | undefined
    editor.update(
      () => {
        const columns = $getColumns()
        columns.forEach((column, index) =>
          column.splice(0, 1, [$paragraph(`Column ${index + 1}`)]),
        )
        textKey = columns[2].getFirstDescendant()?.getKey()
        columns[2].selectEnd()
      },
      { discrete: true },
    )
    setLayout(editor, 2)
    editor.read(() => {
      expect($getColumns().map((column) => column.getTextContent())).toEqual([
        'Column 1',
        'Column 2\n\nColumn 3',
      ])
      expect($selectionKey()).toBe(textKey)
    })
    setLayout(editor, 1)

    editor.read(() => {
      expect($getRoot().getChildren().filter($isColumnLayoutNode)).toHaveLength(
        0,
      )
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent())
          .filter(Boolean),
      ).toEqual(['Column 1', 'Column 2', 'Column 3'])
      expect($selectionKey()).toBe(textKey)
    })
  })

  it('preserves text at column boundaries and inserts a page break after the section', () => {
    const { editor } = mountEditor()
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    setLayout(editor, 2)
    editor.update(
      () => {
        const [left, right] = $getColumns()
        left.splice(0, 1, [$paragraph('Left')])
        right.splice(0, 1, [$paragraph('Right')])
        right.selectStart()
        expect(editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true)).toBe(
          true,
        )
        expect($selectionKey()).toBe(left.getLastDescendant()?.getKey())
        expect(left.getTextContent()).toBe('Left')
        expect(right.getTextContent()).toBe('Right')
        expect(editor.dispatchCommand(INSERT_PAGE_BREAK, undefined)).toBe(true)
        expect($isPageBreakNode($getLayout().getNextSibling())).toBe(true)
      },
      { discrete: true },
    )
  })

  it('restores the last range from a menu and rejects mutations in read-only mode', () => {
    const { editor } = mountEditor()
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    editor.update(() => $setSelection(null), { discrete: true })
    setLayout(editor, 2)
    expect(editor.read(() => $getColumns().length)).toBe(2)

    editor.setEditable(false)
    editor.update(
      () => {
        expect(editor.dispatchCommand(SET_COLUMN_LAYOUT_COMMAND, 3)).toBe(false)
      },
      { discrete: true },
    )
    expect(editor.read(() => $getColumns().length)).toBe(2)
  })

  it('round-trips native state and sanitized HTML with structured content', () => {
    const { editor } = mountEditor()
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    setLayout(editor, 3)
    editor.update(
      () => {
        const [first, second] = $getColumns()
        first.splice(0, 1, [
          $createHeadingNode('h3').append($createTextNode('Summary')),
        ])
        second.splice(0, 1, [$paragraph('Details')])
      },
      { discrete: true },
    )

    const json = editor.getEditorState().toJSON()
    const html = editor.read(() => $generateHtmlFromNodes(editor))
    const { editor: restored } = mountEditor()
    restored.setEditorState(restored.parseEditorState(JSON.stringify(json)))
    restored.read(() => {
      expect($getColumns().map((column) => column.getTextContent())).toEqual([
        'Summary',
        'Details',
        '',
      ])
    })

    const { editor: imported } = mountEditor()
    imported.update(
      () => {
        $getRoot()
          .clear()
          .append(...$generateNodesFromDOM(imported, sanitizedHtml(html)))
      },
      { discrete: true },
    )
    imported.read(() => {
      expect($getColumns().map((column) => column.getTextContent())).toEqual([
        'Summary',
        'Details',
        '',
      ])
      expect($getColumns()[0].getFirstChild()?.getType()).toBe('heading')
    })
  })

  it('keeps the whole layout when copied and copies ordinary text from one column', () => {
    const { editor } = mountEditor()
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    setLayout(editor, 2)
    editor.update(
      () => {
        const root = $getRoot()
        const [first, second] = $getColumns()
        const left = $createTextNode('Left text')
        const right = $createTextNode('Right text')
        first.splice(0, 1, [$createParagraphNode().append(left)])
        second.splice(0, 1, [$createParagraphNode().append(right)])

        const index = $getLayout().getIndexWithinParent()
        const complete = root.select(index, index + 1)
        const layoutData = $generateJSONFromSelectedNodes(editor, complete)
        expect(layoutData.nodes).toMatchObject([
          {
            type: 'column-layout',
            children: [{ type: 'column' }, { type: 'column' }],
          },
        ])

        const partial = left.select(0, 4)
        const inlineData = $generateJSONFromSelectedNodes(editor, partial)
        expect(inlineData.nodes).toMatchObject([{ type: 'text', text: 'Left' }])
      },
      { discrete: true },
    )
  })
})
