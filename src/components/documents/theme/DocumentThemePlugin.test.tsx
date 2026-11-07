import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  ElementNode,
} from 'lexical'
import {
  $setDocumentTheme,
  clearDocumentTheme,
} from '#/lib/documents/document-theme'
import { DocumentThemePlugin } from './DocumentThemePlugin'

let editor: ReturnType<typeof createEditor>
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let sheet: HTMLDivElement
let mounted: boolean

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [editor],
}))
vi.mock('./use-app-mode', () => ({ useResolvedAppMode: () => 'light' }))

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mounted = true
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
  editor.update(() => $getRoot().append($createParagraphNode()), {
    discrete: true,
  })
  await act(() => root.render(<DocumentThemePlugin documentId="doc" ready />))
})

afterEach(async () => {
  if (mounted) await act(() => root.unmount())
  clearDocumentTheme('doc')
  editor.setRootElement(null)
  sheet.remove()
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('applies a scene to the page and sheet, then clears it on unmount', async () => {
  await act(() =>
    editor.update(() => $setDocumentTheme('space'), { discrete: true }),
  )
  const html = document.documentElement
  expect(html.dataset.documentTheme).toBe('space')
  expect(html.style.getPropertyValue('--background')).toBe(
    'oklch(0.17 0.05 265)',
  )
  expect(html.style.colorScheme).toBe('dark')

  await act(() => {
    mounted = false
    root.unmount()
  })
  expect(html.dataset.documentTheme).toBeUndefined()
  expect(html.style.getPropertyValue('--background')).toBe('')
  expect(sheet.style.background).toBe('')
})

it('re-asserts a pinned color scheme after an external change', async () => {
  await act(() =>
    editor.update(() => $setDocumentTheme('space'), { discrete: true }),
  )
  const html = document.documentElement
  expect(html.style.colorScheme).toBe('dark')
  html.style.colorScheme = 'light'
  await act(() =>
    editor.update(
      () => {
        const child = $getRoot().getFirstChild()
        if (child instanceof ElementNode) child.setIndent(1)
      },
      { discrete: true },
    ),
  )
  expect(html.style.colorScheme).toBe('dark')
})

it('returns to the app palette when the document chooses paper', async () => {
  await act(() =>
    editor.update(() => $setDocumentTheme('ocean'), { discrete: true }),
  )
  expect(document.documentElement.style.getPropertyValue('--background')).toBe(
    'oklch(0.955 0.012 259.81)',
  )
  await act(() =>
    editor.update(() => $setDocumentTheme('paper'), { discrete: true }),
  )
  expect(document.documentElement.dataset.documentTheme).toBe('paper')
  expect(document.documentElement.style.getPropertyValue('--background')).toBe(
    '',
  )
  expect(sheet.style.background).toBe('')
})
