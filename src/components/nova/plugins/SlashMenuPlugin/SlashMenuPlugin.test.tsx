import { act } from 'react'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_EDITOR,
  createEditor,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupTestRoot } from '#/test/react-test'
import { INSERT_IMAGE_COMMAND } from '../../images/commands'
import { SlashMenuPlugin } from './SlashMenuPlugin'

let imagesEnabled = true

vi.mock('../../media/document-media-context', () => ({
  useDocumentMedia: () => (imagesEnabled ? {} : null),
}))

const harness = setupTestRoot()
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
)
const rangeLayoutMethods = ['getBoundingClientRect', 'getClientRects'] as const
const originalRangeLayout = Object.getOwnPropertyDescriptors(Range.prototype)
let editor: LexicalEditor
let editable: HTMLDivElement

beforeEach(() => {
  imagesEnabled = true
  editor = createEditor({
    nodes: [HeadingNode, QuoteNode],
    onError: (error) => {
      throw error
    },
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(0, 0, 1, 1),
    },
    getClientRects: {
      configurable: true,
      value: () => [],
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const method of rangeLayoutMethods) {
    const descriptor = originalRangeLayout[method]
    if (descriptor) {
      Object.defineProperty(Range.prototype, method, descriptor)
    } else {
      delete (Range.prototype as Partial<Range>)[method]
    }
  }
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView,
    )
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  }
})

async function mountMenu() {
  await harness.render(
    <LexicalComposerContext.Provider value={[editor, { getTheme: () => null }]}>
      <div
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        ref={(element) => {
          editor.setRootElement(element)
        }}
      />
      <SlashMenuPlugin />
    </LexicalComposerContext.Provider>,
  )
  editable = editor.getRootElement() as HTMLDivElement
  await setQuery('')
}

async function setQuery(query: string) {
  await act(async () => {
    editable.focus()
    editor.update(
      () => {
        const text = $createTextNode(`/${query}`)
        $getRoot().clear().append($createParagraphNode().append(text))
        text.selectEnd()
      },
      { discrete: true },
    )
  })
}

function menu() {
  const element = document.getElementById('typeahead-menu')
  expect(element).not.toBeNull()
  return element!
}

function visibleOptions() {
  return Array.from(menu().querySelectorAll<HTMLElement>('[role="option"]'))
}

function expectSelected(title: string) {
  const selected = menu().querySelectorAll<HTMLElement>(
    '[role="option"][aria-selected="true"]',
  )
  expect(selected).toHaveLength(1)
  expect(selected[0].textContent).toBe(title)
  expect(editable.getAttribute('aria-activedescendant')).toBe(selected[0].id)
}

async function press(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    editable.dispatchEvent(event)
  })
  return event
}

it.each([true, false])(
  'navigates every displayed option sequentially and wraps with images enabled: %s',
  async (enabled) => {
    imagesEnabled = enabled
    await mountMenu()
    const titles = [
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Check list',
      'Quote',
      'Code block',
      'Divider',
      ...(enabled ? ['Image'] : []),
    ]
    expect(visibleOptions().map((option) => option.textContent)).toEqual(titles)
    expectSelected(titles[0])
    for (const title of [...titles.slice(1), titles[0]]) {
      expect((await press('ArrowDown')).defaultPrevented).toBe(true)
      expectSelected(title)
    }
    for (const title of [...titles.slice(1).reverse(), titles[0]]) {
      expect((await press('ArrowUp')).defaultPrevented).toBe(true)
      expectSelected(title)
    }
    expect(document.activeElement).toBe(editable)
  },
)

it('resets filtered navigation and inserts the visibly selected heading on Enter', async () => {
  await mountMenu()
  await press('ArrowUp')
  expectSelected('Image')
  await setQuery('HEADING')
  expect(visibleOptions().map((option) => option.textContent)).toEqual([
    'Heading 1',
    'Heading 2',
    'Heading 3',
  ])
  expectSelected('Heading 1')
  await press('ArrowDown')
  expectSelected('Heading 2')
  expect((await press('Enter')).defaultPrevented).toBe(true)
  expect(editable.querySelector('h2')).not.toBeNull()
  expect(editable.textContent).toBe('')
  expect(document.getElementById('typeahead-menu')).toBeNull()
})

it('shares mouse highlighting with keyboard selection without moving editor focus', async () => {
  await mountMenu()
  const heading = visibleOptions().find(
    (option) => option.textContent === 'Heading 2',
  )!
  await act(async () => {
    heading.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
  expectSelected('Heading 2')
  await press('ArrowDown')
  expectSelected('Heading 3')
  const pointerDown = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    heading.dispatchEvent(pointerDown)
    heading.click()
  })
  expect(pointerDown.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(editable)
  expect(editable.querySelector('h2')).not.toBeNull()
  expect(editable.textContent).toBe('')
  expect(document.getElementById('typeahead-menu')).toBeNull()
})

it('filters by keywords and executes a clicked option exactly once', async () => {
  const insertImage = vi.fn(() => true)
  const unregister = editor.registerCommand(
    INSERT_IMAGE_COMMAND,
    insertImage,
    COMMAND_PRIORITY_EDITOR,
  )
  try {
    await mountMenu()
    await setQuery('photo')
    expect(visibleOptions().map((option) => option.textContent)).toEqual([
      'Image',
    ])
    await act(async () => visibleOptions()[0].click())
    expect(insertImage).toHaveBeenCalledTimes(1)
    expect(editable.textContent).toBe('')
    expect(document.getElementById('typeahead-menu')).toBeNull()
  } finally {
    unregister()
  }
})

it('keeps empty results navigable and dismisses them with Escape without changing text', async () => {
  await mountMenu()
  await setQuery('no matching block')
  expect(visibleOptions()).toHaveLength(0)
  expect(menu().textContent).toContain('No results found.')
  await press('ArrowDown')
  await press('ArrowUp')
  expect(visibleOptions()).toHaveLength(0)
  expect(editable.textContent).toBe('/no matching block')
  expect((await press('Escape')).defaultPrevented).toBe(true)
  expect(document.getElementById('typeahead-menu')).toBeNull()
  expect(editable.textContent).toBe('/no matching block')
})
