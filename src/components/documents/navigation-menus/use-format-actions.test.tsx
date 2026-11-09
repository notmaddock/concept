import { act, useEffect } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { setupTestRoot } from '#/test/react-test'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $setSelection,
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
const harness = setupTestRoot()
let actions: ReturnType<typeof useFormatActions>
let renders = 0
const choices = formatSections.flatMap((section) =>
  section.choices.map((choice) => choice.action),
)
const editorRef: { current: ReturnType<typeof createEditor> | null } = {
  current: null,
}
function Harness({
  active = true,
  documentId = 'doc',
  replacement,
}: {
  active?: boolean
  documentId?: string
  replacement?: typeof editor
}) {
  renders++
  actions = useFormatActions(editorRef, documentId, choices, active)
  useEffect(() => {
    if (replacement) editorRef.current = replacement
  }, [replacement])
  return null
}

beforeEach(async () => {
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
  await act(async () => harness.root.render(<Harness />))
})

async function apply(action: FormatAction) {
  await act(async () => {
    editor.update(() => $applyFormatAction(action), { discrete: true })
    await Promise.resolve()
  })
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
  await act(async () => {
    await actions.run({ kind: 'style', property: 'color', value: '#dc2626' })
    await Promise.resolve()
  })
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
  await act(async () => {
    await actions.run({ kind: 'align', value: 'center' })
    await Promise.resolve()
  })
  editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChildOrThrow()
    expect($isElementNode(node) && node.getFormatType()).toBe('center')
  })
  await act(async () => {
    await actions.run({ kind: 'list', value: 'bullet' })
    await Promise.resolve()
  })
  editor
    .getEditorState()
    .read(() => expect($getRoot().getFirstChild()?.getType()).toBe('list'))
  await act(async () => {
    await actions.run({ kind: 'list', value: 'none' })
    await Promise.resolve()
  })
  await act(async () => {
    await actions.run({ kind: 'indent', value: 'increase' })
    await Promise.resolve()
  })
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

it('keeps formatting subscribers stable when text changes without format changes', async () => {
  // Prime React's state bailout after the initial enabled-state update.
  async function changeText(value: string) {
    await act(() =>
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0].setTextContent(value)
        },
        { discrete: true },
      ),
    )
  }
  await changeText('hello world one')
  const before = renders
  await changeText('hello world two')
  await changeText('hello world three')
  expect(renders).toBe(before)
})

it('pauses hidden formatting controls and refreshes when they become active', async () => {
  await act(async () => harness.root.render(<Harness active={false} />))
  expect(actions.disabled).toBe(true)
  await apply({ kind: 'text', value: 'italic' })
  const italic = choices.find(
    (action) => action.kind === 'text' && action.value === 'italic',
  )!
  expect(actions.checked(italic)).toBeUndefined()
  await act(async () => harness.root.render(<Harness />))
  expect(actions.disabled).toBe(false)
  expect(actions.checked(italic)).toBe(true)
})

it('returns focus from a menu before committing formatting and preserves the selected range', async () => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  editable.tabIndex = 0
  const menu = document.createElement('button')
  document.body.append(editable, menu)
  await act(async () => {
    editor.setRootElement(editable)
    await Promise.resolve()
  })
  menu.focus()
  const warn = vi.spyOn(console, 'warn')
  const focusOnCommit: boolean[] = []
  const unregister = editor.registerUpdateListener(({ dirtyLeaves }) => {
    if (dirtyLeaves.size)
      focusOnCommit.push(document.activeElement === editable)
  })
  try {
    await act(async () => {
      await actions.run({
        kind: 'style',
        property: 'font-family',
        value: 'Georgia',
      })
      await Promise.resolve()
    })
    expect(focusOnCommit).toEqual([true])
    editor.getEditorState().read(() => {
      expect($getSelection()?.getTextContent()).toBe('hello')
      const nodes = $getRoot().getAllTextNodes()
      expect(nodes[0].getStyle()).toContain('font-family: Georgia')
      expect(nodes[1].getStyle()).toBe('')
    })
    expect(warn.mock.calls.flat().join(' ')).not.toContain('updateEditorSync')
  } finally {
    unregister()
    warn.mockRestore()
    await act(async () => {
      editor.setRootElement(null)
      await Promise.resolve()
    })
    editable.remove()
    menu.remove()
  }
})

it('keeps the selected range available when a formatting menu takes focus', async () => {
  await act(() => editor.update(() => $setSelection(null), { discrete: true }))
  expect(actions.disabled).toBe(false)
  await act(async () => {
    await actions.run({ kind: 'text', value: 'italic' })
  })
  editor.getEditorState().read(() => {
    expect($getSelection()?.getTextContent()).toBe('hello')
    expect($getRoot().getAllTextNodes()[0].hasFormat('italic')).toBe(true)
  })
})

it('subscribes to the new editor when it mounts after document navigation', async () => {
  const replacement = createEditor({
    onError: (error) => {
      throw error
    },
  })
  replacement.update(
    () => {
      const text = $createTextNode('new document')
      $getRoot().append($createParagraphNode().append(text))
      text.select(0, 3)
    },
    { discrete: true },
  )
  await act(async () =>
    harness.root.render(
      <Harness documentId="other" replacement={replacement} />,
    ),
  )
  expect(actions.disabled).toBe(false)
  await act(() => replacement.setEditable(false))
  expect(actions.disabled).toBe(true)
  await act(() => editor.setEditable(false))
  await act(() => replacement.setEditable(true))
  expect(actions.disabled).toBe(false)
})

it('reconnects after an editor root is replaced without recursively unregistering', async () => {
  const editable = document.createElement('div')
  editable.contentEditable = 'true'
  document.body.append(editable)
  await act(async () => editor.setRootElement(editable))
  const replacement = createEditor({
    onError: (error) => {
      throw error
    },
  })
  replacement.update(
    () => {
      const text = $createTextNode('replacement')
      $getRoot().append($createParagraphNode().append(text))
      text.select(0, 3)
    },
    { discrete: true },
  )
  const frames: FrameRequestCallback[] = []
  const request = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
  try {
    await act(async () => {
      editor.setRootElement(null)
    })
    expect(actions.disabled).toBe(true)
    await act(async () => frames.shift()!(0))
    expect(actions.disabled).toBe(true)
    editorRef.current = replacement
    await act(async () => frames.shift()!(0))
    expect(actions.disabled).toBe(false)
    await act(async () => replacement.setEditable(false))
    expect(actions.disabled).toBe(true)
  } finally {
    request.mockRestore()
    editable.remove()
  }
})
