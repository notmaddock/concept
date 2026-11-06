import { withDocumentLock } from './lifecycle-lock'
import { packageLimits } from './limits'

export type AssetId = string & { readonly __assetId: unique symbol }

export interface AssetDescriptor {
  id: AssetId
  mediaType: string
  byteLength: number
}

export interface AssetRecord {
  descriptor: AssetDescriptor
  blob: Blob
}

export interface AssetRepository {
  readonly documentId: string
  readonly closed: boolean
  put: (blob: Blob, signal?: AbortSignal) => Promise<AssetDescriptor>
  get: (id: AssetId, signal?: AbortSignal) => Promise<Blob | undefined>
  list: () => Promise<ReadonlyArray<AssetDescriptor>>
  importAssets: (
    records: ReadonlyArray<AssetRecord>,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<AssetDescriptor>>
  pin: (ids: Iterable<AssetId>) => { release: () => void }
  flush: () => Promise<void>
  subscribe: (listener: (id: AssetId) => void) => () => void
  close: () => void
}

export interface AssetRepositoryOptions {
  assertWritable?: () => void | Promise<void>
  maxAssetBytes?: number
  maxConcurrentHashes?: number
}

export class AssetIntegrityError extends Error {
  readonly code = 'asset-integrity'
}

export class AssetLimitError extends Error {
  readonly code = 'asset-limit'
}

export function isAssetId(value: unknown): value is AssetId {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

export async function assetId(
  bytes: Uint8Array | ArrayBuffer,
): Promise<AssetId> {
  const input = bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes
  const digest = await crypto.subtle.digest('SHA-256', input)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as AssetId
}

export function normalizeAssetMediaType(bytes: Uint8Array): string {
  const matches = (signature: ReadonlyArray<number>, offset = 0) =>
    signature.every((byte, index) => bytes[index + offset] === byte)
  if (matches([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (matches([255, 216, 255])) return 'image/jpeg'
  if (matches([71, 73, 70, 56, 55, 97]) || matches([71, 73, 70, 56, 57, 97]))
    return 'image/gif'
  if (matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8))
    return 'image/webp'
  if (matches([37, 80, 68, 70, 45])) return 'application/pdf'
  return 'application/octet-stream'
}

export async function describeAsset(
  blob: Blob,
  signal?: AbortSignal,
): Promise<AssetDescriptor> {
  signal?.throwIfAborted()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  signal?.throwIfAborted()
  const id = await assetId(bytes)
  signal?.throwIfAborted()
  return {
    id,
    mediaType: normalizeAssetMediaType(bytes),
    byteLength: bytes.byteLength,
  }
}

interface StoredAsset extends AssetRecord {
  documentId: string
}

interface AvailabilityMessage {
  documentId: string
  id: AssetId
}

interface FactoryState {
  database?: Promise<IDBDatabase>
  repositories: Map<string, Set<AssetRepository>>
  listeners: Map<string, Set<(id: AssetId) => void>>
  channel?: BroadcastChannel
}

const factories = new WeakMap<IDBFactory, FactoryState>()

function factoryState(factory: IDBFactory): FactoryState {
  let state = factories.get(factory)
  if (!state) {
    state = {
      repositories: new Map(),
      listeners: new Map(),
    }
    factories.set(factory, state)
  }
  return state
}

function database(factory: IDBFactory, state: FactoryState) {
  if (!state.database) {
    const connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('concept-assets', 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('assets', {
          keyPath: ['documentId', 'descriptor.id'],
        })
        store.createIndex('documentId', 'documentId')
      }
      request.onsuccess = () => {
        const db = request.result
        const invalidate = () => {
          if (state.database === connection) state.database = undefined
        }
        db.onversionchange = () => {
          db.close()
          invalidate()
        }
        db.onclose = invalidate
        resolve(db)
      }
      request.onerror = () => reject(request.error)
    })
    state.database = connection
    void connection.catch(() => {
      if (state.database === connection) state.database = undefined
    })
  }
  return state.database
}

function notify(state: FactoryState, message: AvailabilityMessage) {
  state.listeners.get(message.documentId)?.forEach((listener) => {
    try {
      listener(message.id)
    } catch {}
  })
}

function publish(state: FactoryState, message: AvailabilityMessage) {
  notify(state, message)
  if (typeof BroadcastChannel === 'undefined') return
  const channel = state.channel ?? new BroadcastChannel('concept-assets')
  channel.postMessage(message)
  if (!state.channel) channel.close()
}

function listen(
  state: FactoryState,
  documentId: string,
  listener: (id: AssetId) => void,
) {
  const listeners = state.listeners.get(documentId) ?? new Set()
  state.listeners.set(documentId, listeners)
  listeners.add(listener)
  if (!state.channel && typeof BroadcastChannel !== 'undefined') {
    state.channel = new BroadcastChannel('concept-assets')
    state.channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      if (
        message &&
        typeof message === 'object' &&
        'documentId' in message &&
        typeof message.documentId === 'string' &&
        'id' in message &&
        isAssetId(message.id)
      )
        notify(state, { documentId: message.documentId, id: message.id })
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) state.listeners.delete(documentId)
    if (!state.listeners.size) {
      state.channel?.close()
      state.channel = undefined
    }
  }
}

async function read<T>(
  factory: IDBFactory,
  state: FactoryState,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database(factory, state)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readonly')
    const request = action(transaction.objectStore('assets'))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? request.error)
  })
}

export function openAssetRepository(
  documentId: string,
  options: AssetRepositoryOptions = {},
): AssetRepository {
  const factory = indexedDB
  const state = factoryState(factory)
  const pending = new Set<Promise<unknown>>()
  const subscriptions = new Set<() => void>()
  const pins = new Map<AssetId, number>()
  let closed = false
  const ensureOpen = (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (closed) throw new Error('Asset repository closed')
  }
  const track = <T>(task: Promise<T>) => {
    pending.add(task)
    void task.finally(() => pending.delete(task)).catch(() => {})
    return task
  }
  const maxAssetBytes = options.maxAssetBytes ?? packageLimits.assetBytes
  const maxConcurrentHashes =
    options.maxConcurrentHashes ?? packageLimits.concurrentHashes
  if (
    !Number.isSafeInteger(maxAssetBytes) ||
    maxAssetBytes < 0 ||
    !Number.isSafeInteger(maxConcurrentHashes) ||
    maxConcurrentHashes < 1
  )
    throw new AssetLimitError('Invalid asset storage limits')
  let hashing = 0
  const hashWaiters: Array<() => void> = []
  const describe = async (blob: Blob, signal?: AbortSignal) => {
    ensureOpen(signal)
    if (blob.size > maxAssetBytes)
      throw new AssetLimitError('Asset exceeds the configured size limit')
    if (hashing >= maxConcurrentHashes)
      await new Promise<void>((resolve) => hashWaiters.push(resolve))
    else hashing++
    try {
      ensureOpen(signal)
      return await describeAsset(blob, signal)
    } finally {
      const next = hashWaiters.shift()
      if (next) next()
      else hashing--
    }
  }
  const commit = async (
    records: ReadonlyArray<AssetRecord>,
    signal?: AbortSignal,
  ) =>
    withDocumentLock(documentId, async () => {
      ensureOpen(signal)
      await options.assertWritable?.()
      ensureOpen(signal)
      const db = await database(factory, state)
      ensureOpen(signal)
      const inserted: Array<AssetId> = []
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('assets', 'readwrite')
        const store = transaction.objectStore('assets')
        const abort = () => {
          try {
            transaction.abort()
          } catch {}
        }
        signal?.addEventListener('abort', abort, { once: true })
        const cleanup = () => signal?.removeEventListener('abort', abort)
        for (const record of records) {
          const request: IDBRequest<StoredAsset | undefined> = store.get([
            documentId,
            record.descriptor.id,
          ])
          request.onsuccess = () => {
            if (request.result) return
            store.add({ ...record, documentId })
            inserted.push(record.descriptor.id)
          }
        }
        transaction.oncomplete = () => {
          cleanup()
          resolve()
        }
        transaction.onabort = transaction.onerror = () => {
          cleanup()
          reject(
            signal?.reason ??
              transaction.error ??
              new Error('Could not persist assets'),
          )
        }
      })
      ensureOpen(signal)
      inserted.forEach((id) => publish(state, { documentId, id }))
    })
  const repository: AssetRepository = {
    documentId,
    get closed() {
      return closed
    },
    put(blob, signal) {
      return track(
        (async () => {
          const descriptor = await describe(blob, signal)
          await commit(
            [
              {
                descriptor,
                blob: blob.slice(0, blob.size, descriptor.mediaType),
              },
            ],
            signal,
          )
          return descriptor
        })(),
      )
    },
    get(id, signal) {
      return track(
        (async () => {
          ensureOpen(signal)
          if (!isAssetId(id))
            throw new AssetIntegrityError('Invalid asset identity')
          const record = await read<StoredAsset | undefined>(
            factory,
            state,
            (store) => store.get([documentId, id]),
          )
          ensureOpen(signal)
          return record?.blob
        })(),
      )
    },
    list() {
      return track(
        (async () => {
          ensureOpen()
          const records = await read<Array<StoredAsset>>(
            factory,
            state,
            (store) => store.index('documentId').getAll(documentId),
          )
          ensureOpen()
          return records
            .map((record) => ({ ...record.descriptor }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        })(),
      )
    },
    importAssets(records, signal) {
      return track(
        (async () => {
          ensureOpen(signal)
          const verified: Array<AssetRecord> = []
          for (const record of records) {
            const descriptor = await describe(record.blob, signal)
            if (
              descriptor.id !== record.descriptor.id ||
              descriptor.byteLength !== record.descriptor.byteLength
            )
              throw new AssetIntegrityError(
                'Asset bytes do not match their descriptor',
              )
            if (
              !verified.some((entry) => entry.descriptor.id === descriptor.id)
            )
              verified.push({
                descriptor,
                blob: record.blob.slice(
                  0,
                  record.blob.size,
                  descriptor.mediaType,
                ),
              })
          }
          await commit(verified, signal)
          return verified.map((record) => record.descriptor)
        })(),
      )
    },
    pin(ids) {
      ensureOpen()
      const held = new Set(ids)
      for (const id of held) {
        if (!isAssetId(id))
          throw new AssetIntegrityError('Invalid asset identity')
      }
      for (const id of held) pins.set(id, (pins.get(id) ?? 0) + 1)
      let released = false
      return {
        release() {
          if (released) return
          released = true
          for (const id of held) {
            const count = (pins.get(id) ?? 1) - 1
            if (count) pins.set(id, count)
            else pins.delete(id)
          }
        },
      }
    },
    async flush() {
      ensureOpen()
      while (pending.size) await Promise.all([...pending])
      ensureOpen()
    },
    subscribe(listener) {
      ensureOpen()
      const stop = listen(state, documentId, listener)
      const unsubscribe = () => {
        stop()
        subscriptions.delete(unsubscribe)
      }
      subscriptions.add(unsubscribe)
      return unsubscribe
    },
    close() {
      closed = true
      subscriptions.forEach((stop) => stop())
      pins.clear()
      const repositories = state.repositories.get(documentId)
      repositories?.delete(repository)
      if (!repositories?.size) state.repositories.delete(documentId)
    },
  }
  const repositories = state.repositories.get(documentId) ?? new Set()
  state.repositories.set(documentId, repositories)
  repositories.add(repository)
  return repository
}

export async function deleteDocumentAssets(
  documentId: string,
  options: { alreadyLocked?: boolean } = {},
) {
  const factory = indexedDB
  const state = factoryState(factory)
  const remove = async () => {
    state.repositories
      .get(documentId)
      ?.forEach((repository) => repository.close())
    const db = await database(factory, state)
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite')
      const store = transaction.objectStore('assets')
      const request = store.index('documentId').openKeyCursor(documentId)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        store.delete(cursor.primaryKey)
        cursor.continue()
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? request.error)
    })
  }
  if (options.alreadyLocked) await remove()
  else await withDocumentLock(documentId, remove)
}

export async function copyDocumentAssets(
  source: string,
  target: string,
  options: AssetRepositoryOptions = {},
) {
  const from = openAssetRepository(source, options)
  const to = openAssetRepository(target, options)
  try {
    const descriptors = await from.list()
    const pin = from.pin(descriptors.map((descriptor) => descriptor.id))
    try {
      const records: Array<AssetRecord> = []
      for (const descriptor of descriptors) {
        const blob = await from.get(descriptor.id)
        if (!blob)
          throw new AssetIntegrityError('Asset disappeared while copying')
        records.push({ descriptor, blob })
      }
      await to.importAssets(records)
    } finally {
      pin.release()
    }
  } finally {
    from.close()
    to.close()
  }
}
