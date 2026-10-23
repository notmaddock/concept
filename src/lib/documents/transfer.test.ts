import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Doc } from 'yjs'
import { importConcept, parseConcept, serializeConcept } from './concept-file'
import { initializeDocument } from './initial-document'
import type { DocumentInfo } from './storage'
import { storageLocations } from './storage-locations'
import { localDocumentStorage } from './storages/local'
import { documentSaveProviders, documentSources } from './transfer'

const driveMocks = vi.hoisted(() => ({
  listDrive: vi.fn(),
  readDrive: vi.fn(),
  saveDrive: vi.fn(),
}))

vi.mock('./drive/functions', () => driveMocks)

const driveBackingDoc: DocumentInfo = {
  id: '24b29997-31d1-4a76-b458-f601d838424c',
  name: 'Cloud Notes',
  updatedAt: 100,
  backing: {
    provider: 'google-drive',
    fileId: 'drive-file-123',
    accountId: 'acct-1',
    syncedName: 'Cloud Notes',
  },
}

function createSampleConceptFile(name = 'Sample Doc', marker = 'hello-world') {
  const doc = new Doc()
  try {
    initializeDocument(doc)
    doc.getMap('metadata').set('marker', marker)
    return parseConcept(serializeConcept(name, doc))
  } finally {
    doc.destroy()
  }
}

function getLibrarySource(id: string) {
  const source = documentSources.find((entry) => entry.id === id)
  if (!source || source.kind !== 'library') {
    throw new Error(`Expected library source for ${id}`)
  }
  return source
}

function getSaveProvider(id: string) {
  const provider = documentSaveProviders.find((entry) => entry.id === id)
  if (!provider) {
    throw new Error(`Expected save provider for ${id}`)
  }
  return provider
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  driveMocks.listDrive.mockReset()
  driveMocks.readDrive.mockReset()
  driveMocks.saveDrive.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('documentSources', () => {
  it('lists Drive documents via listDrive and filters backed documents out of local source list', async () => {
    const driveSource = getLibrarySource(storageLocations.drive.id)
    const localSource = getLibrarySource(storageLocations.local.id)

    driveMocks.listDrive.mockResolvedValue([driveBackingDoc])
    await expect(driveSource.list()).resolves.toEqual([driveBackingDoc])
    expect(driveMocks.listDrive).toHaveBeenCalledOnce()

    const pureLocal = await localDocumentStorage.create()
    const sampleFile = createSampleConceptFile(driveBackingDoc.name)
    await importConcept(sampleFile, driveBackingDoc.name, driveBackingDoc)

    const allStored = await localDocumentStorage.list()
    expect(allStored).toHaveLength(2)

    const localListed = await localSource.list()
    expect(localListed.map((doc) => doc.id)).toEqual([pureLocal.id])
  })

  it('reads a Drive document into SelectedDocument and imports it on open()', async () => {
    const driveSource = getLibrarySource(storageLocations.drive.id)
    const remoteFile = createSampleConceptFile(
      driveBackingDoc.name,
      'from-drive',
    )
    driveMocks.readDrive.mockResolvedValue({
      document: driveBackingDoc,
      file: remoteFile,
    })

    const selected = await driveSource.read(driveBackingDoc)
    expect(driveMocks.readDrive).toHaveBeenCalledWith({
      data: driveBackingDoc.backing,
    })
    expect(selected).toMatchObject({
      file: remoteFile,
      filename: 'Cloud Notes.concept',
      size: new Blob([JSON.stringify(remoteFile)]).size,
      origin: storageLocations.drive.label,
      existingId: driveBackingDoc.id,
    })
    expect(selected.open).toBeTypeOf('function')

    const opened = await selected.open!()
    expect(opened).toMatchObject({
      id: driveBackingDoc.id,
      name: driveBackingDoc.name,
      backing: driveBackingDoc.backing,
    })

    const verifyDoc = new Doc()
    const session = localDocumentStorage.open(opened.id, verifyDoc)
    try {
      await session.whenSynced
      expect(verifyDoc.getMap('metadata').get('marker')).toBe('from-drive')
    } finally {
      await session.destroy()
      verifyDoc.destroy()
    }
  })

  it('throws when reading a Drive document that is missing backing metadata', async () => {
    const driveSource = getLibrarySource(storageLocations.drive.id)
    await expect(
      driveSource.read({
        id: 'missing-backing',
        name: 'No Backing',
        updatedAt: 1,
      }),
    ).rejects.toThrow('Missing backing file.')
    expect(driveMocks.readDrive).not.toHaveBeenCalled()
  })

  it('reads a local document into SelectedDocument and cleans up its session', async () => {
    const localSource = getLibrarySource(storageLocations.local.id)
    const sampleFile = createSampleConceptFile('Local Draft', 'local-marker')
    const created = await importConcept(sampleFile, 'Local Draft')

    const selected = await localSource.read(created)
    expect(selected).toMatchObject({
      filename: 'Local Draft',
      origin: storageLocations.local.label,
      existingId: created.id,
    })
    expect(selected.size).toBeGreaterThan(0)

    const importedCopy = await importConcept(selected.file, 'Copied Local')
    const verifyDoc = new Doc()
    const session = localDocumentStorage.open(importedCopy.id, verifyDoc)
    try {
      await session.whenSynced
      expect(verifyDoc.getMap('metadata').get('marker')).toBe('local-marker')
    } finally {
      await session.destroy()
      verifyDoc.destroy()
    }
  })
})

describe('documentSaveProviders', () => {
  it('saves a ConceptFile to local storage without cloud backing', async () => {
    const localProvider = getSaveProvider(storageLocations.local.id)
    const file = createSampleConceptFile('Original', 'saved-locally')

    const saved = await localProvider.save(file, 'Saved Local Copy')
    expect(saved.name).toBe('Saved Local Copy')
    expect(saved.backing).toBeUndefined()

    const verifyDoc = new Doc()
    const session = localDocumentStorage.open(saved.id, verifyDoc)
    try {
      await session.whenSynced
      expect(verifyDoc.getMap('metadata').get('marker')).toBe('saved-locally')
    } finally {
      await session.destroy()
      verifyDoc.destroy()
    }
  })

  it('saves a ConceptFile to Google Drive and caches the returned Drive-backed document locally', async () => {
    const driveProvider = getSaveProvider(storageLocations.drive.id)
    const file = createSampleConceptFile('Local Source', 'transferred-to-drive')
    const remoteDoc: DocumentInfo = {
      ...driveBackingDoc,
      name: 'Transferred Doc',
      backing: {
        ...driveBackingDoc.backing!,
        syncedName: 'Transferred Doc',
      },
    }
    driveMocks.saveDrive.mockResolvedValue({
      document: remoteDoc,
      file,
    })

    const saved = await driveProvider.save(file, 'Transferred Doc')
    expect(driveMocks.saveDrive).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        name: 'Transferred Doc',
        text: JSON.stringify(file),
      },
    })
    expect(saved).toMatchObject({
      id: remoteDoc.id,
      name: 'Transferred Doc',
      backing: remoteDoc.backing,
    })

    const stored = await localDocumentStorage.get(remoteDoc.id)
    expect(stored?.backing).toEqual(remoteDoc.backing)
  })

  it('escalates authorization errors from Drive list, read, and save operations', async () => {
    const authError = new Error(
      'Reconnect Google Drive to access your documents.',
    )
    const driveSource = getLibrarySource(storageLocations.drive.id)
    const driveProvider = getSaveProvider(storageLocations.drive.id)
    const file = createSampleConceptFile('Auth Test', 'auth')

    driveMocks.listDrive.mockRejectedValueOnce(authError)
    await expect(driveSource.list()).rejects.toThrow(
      'Reconnect Google Drive to access your documents.',
    )

    driveMocks.readDrive.mockRejectedValueOnce(authError)
    await expect(driveSource.read(driveBackingDoc)).rejects.toThrow(
      'Reconnect Google Drive to access your documents.',
    )

    driveMocks.saveDrive.mockRejectedValueOnce(authError)
    await expect(driveProvider.save(file, 'Auth Test')).rejects.toThrow(
      'Reconnect Google Drive to access your documents.',
    )
  })
})
