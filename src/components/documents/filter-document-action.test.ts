import { expect, it } from 'vitest'
import { filterDocumentAction } from './filter-document-action'

it('ranks exact labels above fuzzy metadata matches across menu groups', () => {
  const exact = filterDocumentAction('format:bold', ' BOLD ', [
    'Bold',
    'Format',
  ])
  const fuzzy = filterDocumentAction('file:export-html', ' BOLD ', [
    'Export as HTML',
    'File',
    'download',
    'bold',
  ])
  expect(exact).toBeGreaterThan(fuzzy)
})

it('prefers label prefixes over substrings and keyword matches', () => {
  const prefix = filterDocumentAction('insert:heading', 'heading', [
    'Heading 1',
  ])
  const substring = filterDocumentAction('format:heading', 'heading', [
    'Toggle heading',
  ])
  const keyword = filterDocumentAction('format:title', 'heading', [
    'Title',
    'heading',
  ])
  expect(prefix).toBeGreaterThan(substring)
  expect(substring).toBeGreaterThan(keyword)
  expect(keyword).toBeGreaterThan(0)
})

it('retains fuzzy and shortcut discovery while hiding unrelated actions', () => {
  expect(filterDocumentAction('format:bold', 'bld', ['Bold'])).toBeGreaterThan(
    0,
  )
  expect(
    filterDocumentAction('format:bold', 'Ctrl B', ['Bold', 'Ctrl', 'B']),
  ).toBeGreaterThan(0)
  expect(filterDocumentAction('format:bold', 'zzzz', ['Bold'])).toBe(0)
})
