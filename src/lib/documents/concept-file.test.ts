import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Doc, XmlText } from 'yjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { importConcept, parseConcept, serializeConcept } from './concept-file'
import { localDocumentStorage } from './storage'

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

it('round trips Unicode content and document settings into independent, persisted copies', async () => {
  const source = new Doc()
  source.get('root', XmlText).insert(0, 'Hello 🌎 — café')
  source.getMap('settings').set('pageSetup', { mode: 'paper', width: 210 })
  const file = parseConcept(serializeConcept('Résumé', source))
  const first = await importConcept(file)
  const second = await importConcept(file, 'Copy of Résumé')
  expect(first.id).not.toBe(second.id)
  expect(first.name).toBe('Résumé')
  expect(second.name).toBe('Copy of Résumé')
  const restored = new Doc()
  const session = localDocumentStorage.open(first.id, restored)
  await session.whenSynced
  expect(restored.get('root', XmlText).toString()).toBe('Hello 🌎 — café')
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
  await session.destroy()
  await copySession.destroy()
  source.destroy()
  restored.destroy()
  copy.destroy()
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
