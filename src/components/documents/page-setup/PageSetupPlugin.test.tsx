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
  sheet.appendChild(editable)
  document.body.appendChild(sheet)
  document.body.appendChild(container)
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
  expect(sheet.style.width).toBe('210mm')
  expect(sheet.style.minHeight).toBe('297mm')
  expect(sheet.style.getPropertyValue('--page-margin-top')).toBe('25.4mm')
  expect(write).toHaveBeenCalledTimes(4)
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
  replacementSheet.appendChild(replacementRoot)
  document.body.appendChild(replacementSheet)
  try {
    await act(() => editor.setRootElement(replacementRoot))
    expect(replacementSheet.style.width).toBe('100%')
    expect(replacementSheet.style.getPropertyValue('--page-margin-top')).toBe(
      '2rem',
    )
  } finally {
    replacementSheet.remove()
  }
})
