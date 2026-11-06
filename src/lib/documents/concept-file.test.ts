import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { applyUpdate, Doc, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  downloadConcept,
  importConcept,
  parseConcept,
  serializeConcept,
} from './concept-file'
import { localDocumentStorage } from './storage'

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

it('round trips Unicode content and document settings into independent, persisted copies', async () => {
  const source = new Doc()
  source.get('root', XmlText).insert(0, 'Hello 🌎 — café')
  source.getMap('metadata').set('name', 'Original embedded title')
  source.getMap('settings').set('pageSetup', { mode: 'paper', width: 210 })
  const file = parseConcept(serializeConcept('Résumé', source))
  const first = await importConcept(file)
  const second = await importConcept(file, '  Copy of Résumé  ')
  const untitled = await importConcept(file, '   ')
  expect(first.id).not.toBe(second.id)
  expect(first.name).toBe('Résumé')
  expect(second.name).toBe('Copy of Résumé')
  expect(untitled.name).toBe('Untitled document')
  const restored = new Doc()
  const session = localDocumentStorage.open(first.id, restored)
  await session.whenSynced
  expect(restored.get('root', XmlText).toString()).toBe('Hello 🌎 — café')
  expect(restored.getMap('metadata').get('name')).toBe('Résumé')
  expect(restored.getMap('settings').get('pageSetup')).toEqual({
    mode: 'paper',
    width: 210,
  })
  restored.get('root', XmlText).insert(0, 'Changed ')
  expect(source.get('root', XmlText).toString()).toBe('Hello 🌎 — café')
  const copy = new Doc()
  const copySession = localDocumentStorage.open(second.id, copy)
  await copySession.whenSynced
  expect(copy.get('root', XmlText).toString()).toBe('Hello 🌎 — café')
  expect(copy.getMap('metadata').get('name')).toBe('Copy of Résumé')
  const blank = new Doc()
  const blankSession = localDocumentStorage.open(untitled.id, blank)
  await blankSession.whenSynced
  expect(blank.getMap('metadata').get('name')).toBe('Untitled document')
  await session.destroy()
  await copySession.destroy()
  await blankSession.destroy()
  source.destroy()
  restored.destroy()
  copy.destroy()
  blank.destroy()
})

it.each([
  'not json',
  '{}',
  JSON.stringify({
    format: 'concept',
    version: 2,
    name: 'Future',
    origin: 'Concept',
    update: 'AAA=',
  }),
  JSON.stringify({
    format: 'concept',
    version: 1,
    name: 'Bad',
    origin: 'Concept',
    update: 'not base64',
  }),
  serializeConcept('Empty', new Doc()),
])(
  'rejects malformed or unsupported files before creating documents: %s',
  async (text) => {
    expect(() => parseConcept(text)).toThrow(
      'not a supported .concept document',
    )
    expect(await localDocumentStorage.list()).toEqual([])
  },
)

it('can reopen downloaded documents whose names exceed the copy field limit', () => {
  const doc = new Doc()
  doc.get('root', XmlText).insert(0, 'Content')
  const name = 'Long document name '.repeat(100)
  expect(parseConcept(serializeConcept(name, doc)).name).toBe(name.trim())
  doc.destroy()
})

it('round trips content larger than the base64 encoding chunk size', () => {
  const source = new Doc()
  const content = 'Large unicode text 🌎 café '.repeat(12000)
  source.get('root', XmlText).insert(0, content)
  const file = parseConcept(serializeConcept('Large', source))
  expect(file.update.length).toBeGreaterThan(8192)
  const restored = new Doc()
  const binary = Uint8Array.from(atob(file.update), (character) =>
    character.charCodeAt(0),
  )
  applyUpdate(restored, binary)
  expect(restored.get('root', XmlText).toString()).toBe(content)
  source.destroy()
  restored.destroy()
})

it.each([
  null,
  [],
  {
    format: 'concept',
    version: 1,
    origin: 'Concept',
    name: '  ',
    update: 'AAA=',
  },
  {
    format: 'concept',
    version: 1,
    origin: 'Concept',
    name: 123,
    update: 'AAA=',
  },
  {
    format: 'concept',
    version: 1,
    origin: 'Other',
    name: 'Name',
    update: 'AAA=',
  },
  {
    format: 'concept',
    version: 1,
    origin: 'Concept',
    name: 'Name',
    update: 123,
  },
])('rejects invalid file metadata: %j', (value) => {
  expect(() => parseConcept(JSON.stringify(value))).toThrow(
    'not a supported .concept document',
  )
})

it('downloads a .concept file with a sanitized filename', async () => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:concept')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Draft_v1.concept')
      expect(this.isConnected).toBe(true)
    })
  const doc = new Doc()
  try {
    doc.get('root', XmlText).insert(0, 'Hello')
    await downloadConcept('Draft:v1. ', doc)
    expect(create).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:concept')
  } finally {
    doc.destroy()
    click.mockRestore()
    vi.useRealTimers()
  }
})

it('deletes the created document and closes the session if import fails during flush', async () => {
  const source = new Doc()
  source.get('root', XmlText).insert(0, 'Hello')
  const file = parseConcept(serializeConcept('Broken import', source))
  source.destroy()
  const originalOpen = localDocumentStorage.open.bind(localDocumentStorage)
  let destroyed = false
  const openSpy = vi
    .spyOn(localDocumentStorage, 'open')
    .mockImplementation((id, doc) => {
      const session = originalOpen(id, doc)
      return {
        whenSynced: session.whenSynced,
        flush: () => Promise.reject(new Error('QuotaExceededError')),
        destroy: async () => {
          destroyed = true
          await session.destroy()
        },
      }
    })
  try {
    await expect(importConcept(file)).rejects.toThrow('QuotaExceededError')
    expect(destroyed).toBe(true)
    expect(await localDocumentStorage.list()).toEqual([])
  } finally {
    openSpy.mockRestore()
  }
})
