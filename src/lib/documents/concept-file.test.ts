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
import { localDocumentStorage } from './storages/local'
import { conceptFileSize } from './serialization'
import { convertImport } from './import'

async function contentDocument(content: string) {
  const file = await convertImport(
    { name: 'Text.txt', text: async () => content } as File,
    'text',
  )
  const doc = new Doc()
  applyUpdate(
    doc,
    Uint8Array.from(atob(file.update), (character) => character.charCodeAt(0)),
  )
  return doc
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

it('round trips Unicode content and document settings into independent, persisted copies', async () => {
  const source = await contentDocument('Hello 🌍 — café')
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
  expect(restored.get('root', XmlText).toJSON()).toEqual(
    source.get('root', XmlText).toJSON(),
  )
  expect(restored.getMap('settings').get('pageSetup')).toEqual({
    mode: 'paper',
    width: 210,
  })
  restored.get('root', XmlText).insert(0, 'Changed ')
  expect(source.get('root', XmlText).toString()).not.toContain('Changed ')
  const copy = new Doc()
  const copySession = localDocumentStorage.open(second.id, copy)
  await copySession.whenSynced
  expect(copy.get('root', XmlText).toJSON()).toEqual(
    source.get('root', XmlText).toJSON(),
  )
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

it('can reopen downloaded documents whose names exceed the copy field limit', async () => {
  const doc = await contentDocument('Content')
  const name = 'Long document name '.repeat(100)
  expect(parseConcept(serializeConcept(name, doc)).name).toBe(name.trim())
  doc.destroy()
})

it('round trips content larger than the base64 encoding chunk size', async () => {
  const content = 'Large unicode text 🌍 café '.repeat(12000)
  const source = await contentDocument(content)
  const file = parseConcept(serializeConcept('Large', source))
  expect(file.update.length).toBeGreaterThan(8192)
  const restored = new Doc()
  const binary = Uint8Array.from(atob(file.update), (character) =>
    character.charCodeAt(0),
  )
  applyUpdate(restored, binary)
  expect(restored.get('root', XmlText).toJSON()).toEqual(
    source.get('root', XmlText).toJSON(),
  )
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

it.each(['text', 'map', 'unknown-node'])(
  'rejects malformed %s roots before import',
  async (kind) => {
    const doc = new Doc()
    if (kind === 'map') doc.getMap('root').set('unrelated', 'content')
    else if (kind === 'text')
      doc.get('root', XmlText).insert(0, 'invalid root text')
    else {
      const child = new XmlText()
      child.setAttribute('__type', 'unsupported-node')
      doc.get('root', XmlText).insertEmbed(0, child)
    }
    const text = serializeConcept('Invalid', doc)
    expect(() => parseConcept(text)).toThrow(
      'not a supported .concept document',
    )
    await expect(importConcept(JSON.parse(text))).rejects.toThrow()
    expect(await localDocumentStorage.list()).toEqual([])
    doc.destroy()
  },
)

it('accepts an empty editable document', async () => {
  const doc = await contentDocument('')
  expect(parseConcept(serializeConcept('Empty', doc)).name).toBe('Empty')
  doc.destroy()
})

it('measures exported UTF-8 file size including Unicode metadata and Base64 padding', () => {
  const doc = new Doc()
  for (const text of ['a', 'ab', 'café 🌍']) {
    doc.getText('content').insert(0, text)
    const name = 'Résumé "quoted" 🌍'
    expect(conceptFileSize(name, doc)).toBe(
      new Blob([serializeConcept(name, doc)]).size,
    )
  }
  doc.destroy()
})

it('attaches download link to DOM, clicks it, and cleans it up', () => {
  const doc = new Doc()
  const appendChildSpy = vi.spyOn(document.body, 'appendChild')
  const removeChildSpy = vi.spyOn(document.body, 'removeChild')
  let clicked = false
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const el = originalCreateElement(tagName)
    if (tagName === 'a') {
      el.click = () => {
        clicked = true
        // Verify link is currently connected to DOM when clicked
        expect(document.body.contains(el)).toBe(true)
      }
    }
    return el
  })

  downloadConcept('My Document', doc)

  expect(clicked).toBe(true)
  expect(appendChildSpy).toHaveBeenCalled()
  expect(removeChildSpy).toHaveBeenCalled()
  doc.destroy()
})

it("preserves the latest updatedAt timestamp when importing an existing target document", async () => {
  const source = await contentDocument("Content")
  const file = parseConcept(serializeConcept("Timestamp Test", source))
  const initial = await importConcept(file)
  const initialUpdatedAt = initial.updatedAt

  // Simulate re-importing with a stale target.updatedAt from remote
  const staleTarget = {
    ...initial,
    updatedAt: 1000,
  }

  const updated = await importConcept(file, "Timestamp Test", staleTarget)
  expect(updated.updatedAt).toBeGreaterThanOrEqual(initialUpdatedAt)
  expect(updated.updatedAt).toBeGreaterThan(1000)

  source.destroy()
})
