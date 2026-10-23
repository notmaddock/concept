import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeNode } from '@lexical/code'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingTextFormatToolbar } from './FloatingTextFormatToolbar'
import type { FormatState, PositionRect } from './types'

const defaultFormatState: FormatState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isSubscript: false,
  isSuperscript: false,
  isCode: false,
}

const sampleRect: PositionRect = {
  top: 100,
  left: 120,
  width: 80,
  height: 24,
}

let container: HTMLDivElement
let editorHost: HTMLDivElement
let root: Root
let editor: ReturnType<typeof createEditor>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  container = document.createElement('div')
  editorHost = document.createElement('div')
  document.body.appendChild(container)
  document.body.appendChild(editorHost)
  root = createRoot(container)
  editor = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode],
  })
  editor.setRootElement(editorHost)
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      const text = $createTextNode('Selected text')
      paragraph.append(text)
      $getRoot().append(paragraph)
      text.select(0, text.getTextContentSize())
    },
    { discrete: true },
  )
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  editor.setRootElement(null)
  container.remove()
  editorHost.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function findButtonByLabel(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button'),
  ).find((btn) => btn.getAttribute('aria-label') === label)
}

describe('FloatingTextFormatToolbar', () => {
  it('renders format buttons, reflects active states, and dispatches text format commands', async () => {
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')
    const onOpenChange = vi.fn()

    await act(async () => {
      root.render(
        <FloatingTextFormatToolbar
          editor={editor}
          isOpen={true}
          rangeRect={sampleRect}
          formatState={{ ...defaultFormatState, isBold: true }}
          onOpenChange={onOpenChange}
        />,
      )
    })

    const toolbar = document.querySelector('[role="toolbar"]')
    expect(toolbar).not.toBeNull()

    const boldButton = findButtonByLabel('Bold')
    const italicButton = findButtonByLabel('Italic')
    const underlineButton = findButtonByLabel('Underline')
    const strikethroughButton = findButtonByLabel('Strikethrough')

    expect(boldButton?.getAttribute('aria-pressed')).toBe('true')
    expect(italicButton?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      italicButton?.click()
      underlineButton?.click()
      strikethroughButton?.click()
    })

    expect(dispatchSpy).toHaveBeenCalledWith(FORMAT_TEXT_COMMAND, 'italic')
    expect(dispatchSpy).toHaveBeenCalledWith(FORMAT_TEXT_COMMAND, 'underline')
    expect(dispatchSpy).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'strikethrough',
    )
  })

  it('toggles the typography controls panel and applies color palette selections to the editor', async () => {
    const onOpenChange = vi.fn()

    await act(async () => {
      root.render(
        <FloatingTextFormatToolbar
          editor={editor}
          isOpen={true}
          rangeRect={sampleRect}
          formatState={defaultFormatState}
          onOpenChange={onOpenChange}
        />,
      )
    })

    const moreButton = findButtonByLabel('More formatting')
    expect(moreButton?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      moreButton?.click()
    })
    expect(moreButton?.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-expanded="true"]')).not.toBeNull()

    // Open Text color popover and apply Automatic / reset color
    const textColorButton = findButtonByLabel('Text color')
    expect(textColorButton).toBeDefined()
    await act(async () => {
      textColorButton?.click()
    })

    const paletteGroup = document.querySelector(
      '[aria-label="Text color palette"]',
    )
    expect(paletteGroup).not.toBeNull()

    // Apply an inline style first, then click Automatic to verify ColorSelect updates selection
    await act(async () => {
      editor.update(
        () => {
          const node = $getRoot().getFirstDescendant()
          if ($isTextNode(node)) {
            node.setStyle('color: rgb(220, 38, 38);')
          }
        },
        { discrete: true },
      )
    })

    const automaticBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent.trim() === 'Automatic')
    expect(automaticBtn).toBeDefined()

    await act(async () => {
      automaticBtn?.click()
    })

    editor.getEditorState().read(() => {
      const node = $getRoot().getFirstDescendant()
      expect($isTextNode(node) ? node.getStyle() : '').toBe('')
    })
  })
})
