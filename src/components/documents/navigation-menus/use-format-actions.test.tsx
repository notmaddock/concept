import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  createEditor,
} from 'lexical'
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text'
import { ListNode, ListItemNode, registerList } from '@lexical/list'
import {
  paragraphDOM,
  $getParagraphStyle,
} from '#/components/nova/paragraph-format'
import { $applyFormatAction, useFormatActions } from './use-format-actions'
import { formatSections } from './format-options'
import type { FormatAction } from './format-options'

let editor: ReturnType<typeof createEditor>
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let actions: ReturnType<typeof useFormatActions>
const choices = formatSections.flatMap((section) =>
  section.choices.map((choice) => choice.action),
)
const editorRef: { current: ReturnType<typeof createEditor> | null } = {
  current: null,
}
function Harness() {
  actions = useFormatActions(editorRef, 'doc', choices)
  return null
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
  editor = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    dom: paragraphDOM,
    onError: (error) => {
      throw error
    },
  })
  registerRichText(editor)
  registerList(editor)
  editorRef.current = editor
  editor.update(
    () => {
      const text = $createTextNode('hello world').setFormat('bold')
      $getRoot().append(
        $createParagraphNode().append(text),
        $createParagraphNode().append($createTextNode('untouched')),
      )
      text.select(0, 5)
    },
    { discrete: true },
  )
  await act(() => root.render(<Harness />))
})
afterEach(async () => {
  await act(() => root.unmount())
  vi.unstubAllGlobals()
})

async function apply(action: FormatAction) {
  await act(() =>
    editor.update(() => $applyFormatAction(action), { discrete: true }),
  )
}
it('styles only selected characters and preserves surrounding text', async () => {
  await apply({ kind: 'style', property: 'color', value: '#dc2626' })
  editor.getEditorState().read(() => {
    const nodes = $getRoot().getAllTextNodes()
    expect(nodes.map((node) => node.getTextContent())).toEqual([
      'hello',
      ' world',
      'untouched',
    ])
    expect(nodes[0].getStyle()).toContain('#dc2626')
    expect(nodes[1].getStyle()).toBe('')
    expect(nodes[0].hasFormat('bold')).toBe(true)
  })
})
it('combines paragraph spacing and direction without changing other paragraphs', async () => {
  await apply({ kind: 'paragraph', property: 'line-height', value: '2' })
  await apply({ kind: 'paragraph', property: 'margin-top', value: '12pt' })
  await apply({ kind: 'direction', value: 'rtl' })
  editor.getEditorState().read(() => {
    const [first, second] = $getRoot().getChildren()
    if (!$isElementNode(first) || !$isElementNode(second))
      throw new Error('Expected paragraphs')
    expect($getParagraphStyle(first)).toContain('line-height: 2')
    expect($getParagraphStyle(first)).toContain('margin-top: 12pt')
    expect(first.getDirection()).toBe('rtl')
    expect($getParagraphStyle(second)).toBe('')
  })
})
it('changes paragraph type while retaining text and selection', async () => {
  await apply({ kind: 'block', value: 'h4' })
  editor.getEditorState().read(() => {
    expect($getRoot().getFirstChild()?.getType()).toBe('heading')
    expect($getSelection()?.getTextContent()).toBe('hello')
  })
})
it('clears selected text formatting and keeps the remaining text bold', async () => {
  await apply({ kind: 'clear', value: 'text' })
  editor.getEditorState().read(() => {
    const [first, second] = $getRoot().getAllTextNodes()
    expect(first.hasFormat('bold')).toBe(false)
    expect(second.hasFormat('bold')).toBe(true)
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.format).toBe(0)
  })
})
it('exposes multiple active styles and updates their state', async () => {
  const bold = choices.find(
    (action) => action.kind === 'text' && action.value === 'bold',
  )!
  const italic = choices.find(
    (action) => action.kind === 'text' && action.value === 'italic',
  )!
  await apply(italic)
  expect(actions.checked(bold)).toBe(true)
  expect(actions.checked(italic)).toBe(true)
})
it('disables formatting in read-only editors', async () => {
  await act(() => editor.setEditable(false))
  expect(actions.disabled).toBe(true)
  await act(() =>
    actions.run({ kind: 'style', property: 'color', value: '#dc2626' }),
  )
  editor
    .getEditorState()
    .read(() => expect($getRoot().getAllTextNodes()[0].getStyle()).toBe(''))
})

it('persists paragraph formatting through JSON reload and renders it', async () => {
  await apply({ kind: 'paragraph', property: 'line-height', value: '2' })
  await apply({ kind: 'block', value: 'h2' })
  const saved = JSON.stringify(editor.getEditorState().toJSON())
  await act(() => editor.setEditorState(editor.parseEditorState(saved)))
  editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChildOrThrow()
    expect($getParagraphStyle(node)).toContain('line-height: 2')
    const dom = document.createElement('h2')
    paragraphDOM.$decorateDOM(node, null, dom)
    expect(dom.style.lineHeight).toBe('2')
  })
})
it('runs list, alignment, and indentation commands through menu actions', async () => {
  await act(() => actions.run({ kind: 'align', value: 'center' }))
  editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChildOrThrow()
    expect($isElementNode(node) && node.getFormatType()).toBe('center')
  })
  await act(() => actions.run({ kind: 'list', value: 'bullet' }))
  editor
    .getEditorState()
    .read(() => expect($getRoot().getFirstChild()?.getType()).toBe('list'))
  await act(() => actions.run({ kind: 'list', value: 'none' }))
  await act(() => actions.run({ kind: 'indent', value: 'increase' }))
  editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChildOrThrow()
    expect($isElementNode(node) && node.getIndent()).toBe(1)
  })
})

it('renders spacing with the application extension configuration', async () => {
  const { buildEditorFromExtensions } = await import('@lexical/extension')
  const { editorExtension } = await import('#/components/nova/editor')
  const applicationEditor = buildEditorFromExtensions(editorExtension)
  const element = document.createElement('div')
  element.contentEditable = 'true'
  document.body.append(element)
  applicationEditor.setRootElement(element)
  try {
    applicationEditor.update(
      () => {
        $getRoot().getFirstChildOrThrow().selectStart()
        $applyFormatAction({
          kind: 'paragraph',
          property: 'line-height',
          value: '2',
        })
      },
      { discrete: true },
    )
    expect((element.firstElementChild as HTMLElement).style.lineHeight).toBe(
      '2',
    )
  } finally {
    applicationEditor.dispose()
    element.remove()
  }
})
