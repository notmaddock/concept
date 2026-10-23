import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import type { LexicalEditor, TextNode } from 'lexical'
import { $isHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { HorizontalRuleNode } from '@lexical/extension'
import type * as TypeaheadModule from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockOption } from './options'
import type { OnSelectOptionCallback } from './types'
import { SlashMenuPlugin } from './SlashMenuPlugin'
import { SlashMenuPluginMenu } from './SlashMenuPluginMenu'

let capturedProps: {
  onQueryChange: (matchingString: string | null) => void
  onSelectOption: OnSelectOptionCallback<BlockOption>
  options: Array<BlockOption>
  triggerFn: (
    text: string,
    editor: LexicalEditor,
  ) => {
    leadOffset: number
    matchingString: string
    replaceableString: string
  } | null
  menuRenderFn: (
    anchorElementRef: { current: HTMLElement | null },
    itemProps: {
      selectedIndex: number | null
      selectOptionAndCleanUp: (option: BlockOption) => void
      setHighlightedIndex: (index: number) => void
      options: Array<BlockOption>
    },
    matchingString: string,
  ) => React.ReactNode
} | null = null

let scrollDescriptor: PropertyDescriptor | undefined

let editor: ReturnType<typeof createEditor>

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [editor],
}))

vi.mock('@lexical/react/LexicalTypeaheadMenuPlugin', async (importOriginal) => {
  const actual = await importOriginal<typeof TypeaheadModule>()
  return {
    ...actual,
    LexicalTypeaheadMenuPlugin: (props: NonNullable<typeof capturedProps>) => {
      capturedProps = props
      return null
    },
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const originalScroll = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView',
  )
  scrollDescriptor = originalScroll
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  capturedProps = null
  editor = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, HorizontalRuleNode],
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  if (scrollDescriptor)
    Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SlashMenuPlugin', () => {
  it('matches slash triggers, filters options by title and keyword, and executes block selection cleanup', async () => {
    await act(async () => {
      root.render(<SlashMenuPlugin />)
    })

    expect(capturedProps).not.toBeNull()

    // Trigger matching on '/'
    expect(capturedProps!.triggerFn('/h1', editor)).toEqual({
      leadOffset: 0,
      matchingString: 'h1',
      replaceableString: '/h1',
    })
    expect(capturedProps!.triggerFn('Hello /quote', editor)).toEqual({
      leadOffset: 6,
      matchingString: 'quote',
      replaceableString: '/quote',
    })
    expect(capturedProps!.triggerFn('plain text', editor)).toBeNull()

    const composing = vi.spyOn(editor, 'isComposing').mockReturnValue(true)
    expect(capturedProps!.triggerFn('/h1', editor)).toBeNull()
    composing.mockRestore()

    // Initially all 9 block options are returned
    expect(capturedProps!.options.length).toBeGreaterThanOrEqual(8)

    // Filtering by keyword ('h1') narrows options to Heading 1
    await act(async () => {
      capturedProps!.onQueryChange('h1')
    })
    expect(capturedProps!.options.map((o) => o.key)).toEqual(['heading-1'])

    // Filtering by title ('Quote') narrows options to Quote
    await act(async () => {
      capturedProps!.onQueryChange('Quote')
    })
    expect(capturedProps!.options.map((o) => o.key)).toEqual(['quote'])

    // Selecting Heading 1 removes the slash queryNode, converts the block, and closes the menu
    await act(async () => {
      capturedProps!.onQueryChange('h1')
    })
    const heading1Option = capturedProps!.options[0]
    let slashNode!: TextNode
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        slashNode = $createTextNode('/h1')
        paragraph.append(slashNode)
        $getRoot().append(paragraph)
        slashNode.selectEnd()
      },
      { discrete: true },
    )

    const closeMenu = vi.fn()
    const composingSelection = vi
      .spyOn(editor, 'isComposing')
      .mockReturnValue(true)
    editor.update(
      () => {
        capturedProps!.onSelectOption(
          heading1Option,
          slashNode,
          closeMenu,
          'h1',
        )
      },
      { discrete: true },
    )
    expect(closeMenu).not.toHaveBeenCalled()
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('/h1')
    })
    composingSelection.mockRestore()
    await act(async () => {
      editor.update(
        () => {
          capturedProps!.onSelectOption(
            heading1Option,
            slashNode,
            closeMenu,
            'h1',
          )
        },
        { discrete: true },
      )
    })

    expect(closeMenu).toHaveBeenCalledOnce()
    editor.getEditorState().read(() => {
      const firstBlock = $getRoot().getFirstChild()
      expect($isHeadingNode(firstBlock)).toBe(true)
      if ($isHeadingNode(firstBlock)) {
        expect(firstBlock.getTag()).toBe('h1')
        expect(firstBlock.getTextContent()).toBe('')
      }
    })
  })

  it('renders grouped options in SlashMenuPluginMenu and supports keyboard highlighting, click selection and empty state', async () => {
    await act(async () => {
      root.render(<SlashMenuPlugin />)
    })

    const anchor = document.createElement('div')
    document.body.appendChild(anchor)
    const selectOptionAndCleanUp = vi.fn()
    const setHighlightedIndex = vi.fn()
    const options = capturedProps!.options

    try {
      await act(async () => {
        root.render(
          <SlashMenuPluginMenu
            anchorElementRef={{ current: anchor }}
            itemProps={{
              selectedIndex: 0,
              selectOptionAndCleanUp,
              setHighlightedIndex,
              options,
            }}
            matchingString=""
          />,
        )
      })

      expect(anchor.textContent).toContain('Heading 1')
      expect(anchor.textContent).toContain('Bulleted list')

      const headingItem = Array.from(
        anchor.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
      ).find((el) => el.textContent.includes('Heading 1'))
      expect(headingItem).toBeDefined()

      await act(async () => {
        headingItem!.click()
      })
      expect(selectOptionAndCleanUp).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'heading-1' }),
      )

      const command = anchor.querySelector<HTMLElement>('[cmdk-root]')!
      expect(command).not.toBeNull()
      await act(async () => {
        command.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        )
      })
      expect(setHighlightedIndex).toHaveBeenCalledWith(1)

      // Empty options renders "No results found."
      await act(async () => {
        root.render(
          <SlashMenuPluginMenu
            anchorElementRef={{ current: anchor }}
            itemProps={{
              selectedIndex: null,
              selectOptionAndCleanUp,
              setHighlightedIndex,
              options: [],
            }}
            matchingString="nonexistent"
          />,
        )
      })
      expect(anchor.textContent).toContain('No results found.')
    } finally {
      anchor.remove()
    }
  })
})
