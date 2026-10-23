import { afterEach, expect, it } from 'vitest'
import { colorPalette } from '#/lib/color-palette'
import { resetDocumentTheme } from './theme-transition'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import {
  documentThemes,
  getDocumentTheme,
  observeDocumentTheme,
  setDocumentTheme,
} from './document-theme'

const docs: Doc[] = []
function createDoc() {
  const doc = new Doc()
  docs.push(doc)
  return doc
}
afterEach(() => {
  docs.splice(0).forEach((doc) => doc.destroy())
  resetDocumentTheme()
  document.documentElement.classList.remove('dark')
})

it('uses the existing theme for older documents and unknown palette IDs', () => {
  const doc = createDoc()
  expect(getDocumentTheme(doc)).toBe('default')
  doc.getMap('settings').set('theme', 'future-theme')
  expect(getDocumentTheme(doc)).toBe('default')
})

it('persists the palette in document state and applies remote changes to the whole page', () => {
  const source = createDoc()
  const client = createDoc()
  document.documentElement.classList.add('dark')
  const stop = observeDocumentTheme(client)
  setDocumentTheme(source, 'pink')
  applyUpdate(client, encodeStateAsUpdate(source))
  expect(getDocumentTheme(client)).toBe('pink')
  expect(document.documentElement.dataset.documentTheme).toBe('pink')
  expect(document.documentElement.classList.contains('dark')).toBe(true)

  const reopened = createDoc()
  applyUpdate(reopened, encodeStateAsUpdate(client))
  expect(getDocumentTheme(reopened)).toBe('pink')
  setDocumentTheme(source, 'green')
  applyUpdate(client, encodeStateAsUpdate(source))
  expect(document.documentElement.dataset.documentTheme).toBe('green')
  stop()
  setDocumentTheme(client, 'red')
  expect(document.documentElement.dataset.documentTheme).toBe('green')
  resetDocumentTheme()
  expect(document.documentElement.dataset.documentTheme).toBeUndefined()
})

it('uses the selection popover colors in the same order', () => {
  expect(
    documentThemes
      .slice(1)
      .map(({ label, color }) => ({ label, value: color })),
  ).toEqual(colorPalette.map(({ label, value }) => ({ label, value })))
})

it('maps previously saved yellow and purple palettes to amber and violet', () => {
  const doc = createDoc()
  doc.getMap('settings').set('theme', 'yellow')
  expect(getDocumentTheme(doc)).toBe('amber')
  doc.getMap('settings').set('theme', 'purple')
  expect(getDocumentTheme(doc)).toBe('violet')
})
