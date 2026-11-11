import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { $setPageSetup, DEFAULT_PAGE_SETUP } from '#/lib/documents/page-setup'
import { PageSetupPlugin } from './PageSetupPlugin'

let editor: ReturnType<typeof createEditor>
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let sheet: HTMLDivElement

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [editor],
}))

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  sheet = document.createElement('div')
  sheet.setAttribute('data-document-sheet', '')
  const editable = document.createElement('div')
  sheet.append(editable)
  document.body.append(sheet, container)
  root = createRoot(container)
  editor = createEditor({
    onError(error) {
      throw error
    },
  })
  editor.setRootElement(editable)
  editor.update(
    () =>
      $getRoot().append(
        $createParagraphNode().append($createTextNode('hello')),
      ),
    { discrete: true },
  )
  await act(() =>
    root.render(<PageSetupPlugin open={false} onOpenChange={() => {}} />),
  )
})

afterEach(async () => {
  await act(() => root.unmount())
  editor.setRootElement(null)
  sheet.remove()
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('leaves page geometry untouched during text edits and applies changed settings', async () => {
  const write = vi.spyOn(sheet.style, 'setProperty')
  await act(() =>
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].setTextContent('hello world')
      },
      { discrete: true },
    ),
  )
  expect(write).not.toHaveBeenCalled()
  await act(() =>
    editor.update(
      () => $setPageSetup({ ...DEFAULT_PAGE_SETUP, mode: 'paper' }),
      { discrete: true },
    ),
  )
  expect(sheet.dataset.pageMode).toBe('paper')
  expect(sheet.style.width).toBe('min(100%, 793.7008px)')
  expect(sheet.style.maxWidth).toBe('none')
  expect(sheet.style.minHeight).toBe('100%')
  expect(sheet.style.getPropertyValue('--page-width')).toBe('793.7008px')
  expect(sheet.style.getPropertyValue('--page-height')).toBe('1122.5197px')
  expect(sheet.style.getPropertyValue('--page-margin-top')).toBe('96px')
  expect(sheet.style.getPropertyValue('--document-content-padding')).toBe('0px')
  expect(write).toHaveBeenCalledTimes(9)
  write.mockClear()
  await act(() =>
    editor.update(
      () =>
        $setPageSetup({
          ...DEFAULT_PAGE_SETUP,
          mode: 'paper',
          margins: { ...DEFAULT_PAGE_SETUP.margins },
        }),
      { discrete: true },
    ),
  )
  expect(write).not.toHaveBeenCalled()
})

it('applies the current settings when the editor root moves to a new sheet', async () => {
  const replacementSheet = document.createElement('div')
  replacementSheet.setAttribute('data-document-sheet', '')
  const replacementRoot = document.createElement('div')
  replacementSheet.append(replacementRoot)
  document.body.append(replacementSheet)
  try {
    await act(() => editor.setRootElement(replacementRoot))
    expect(replacementSheet.dataset.pageMode).toBe('pageless')
    expect(replacementSheet.style.width).toBe('100%')
    expect(replacementSheet.style.maxWidth).toBe('960px')
    expect(replacementSheet.style.getPropertyValue('--page-margin-top')).toBe(
      '2rem',
    )
    expect(
      replacementSheet.style.getPropertyValue('--document-content-padding'),
    ).toBe('2rem clamp(1.5rem, 6vw, 4rem)')
  } finally {
    replacementSheet.remove()
  }
})
