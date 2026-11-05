import type { Doc } from 'yjs'
import type { AssetDescriptor, AssetId, AssetRepository } from './assets'
import { documentAssets } from './working'

export class AssetInsertionError extends Error {
  constructor(readonly code: 'closed' | 'read-only' | 'storage-unavailable') {
    super(
      code === 'read-only'
        ? 'This document is read-only.'
        : code === 'closed'
          ? 'The document is closed.'
          : 'Local asset storage is unavailable.',
    )
    this.name = 'AssetInsertionError'
  }
}

export interface InsertDocumentAssetOptions {
  doc: Doc
  blob: Blob
  insert: (descriptor: AssetDescriptor) => void
  canEdit: () => boolean
  flush: () => Promise<void>
  requestSave: () => void
  signal?: AbortSignal
  isAlive?: () => boolean
}

export async function insertDocumentAsset({
  doc,
  blob,
  insert,
  canEdit,
  flush,
  requestSave,
  signal,
  isAlive = () => !doc.isDestroyed,
}: InsertDocumentAssetOptions): Promise<AssetDescriptor> {
  const ensureEditable = () => {
    signal?.throwIfAborted()
    if (!isAlive()) throw new AssetInsertionError('closed')
    if (!canEdit()) throw new AssetInsertionError('read-only')
  }
  ensureEditable()
  const repository = documentAssets(doc)
  if (!repository) throw new AssetInsertionError('storage-unavailable')
  const descriptor = await repository.put(blob, signal)
  ensureEditable()
  if (repository.closed || documentAssets(doc) !== repository)
    throw new AssetInsertionError('closed')
  doc.transact(() => insert(descriptor))
  await flush()
  signal?.throwIfAborted()
  if (!isAlive()) throw new AssetInsertionError('closed')
  requestSave()
  return descriptor
}

export type AssetInsertionOutcome =
  | { status: 'inserted'; descriptors: ReadonlyArray<AssetDescriptor> }
  | {
      status: 'durability-failed'
      descriptors: ReadonlyArray<AssetDescriptor>
      error: unknown
    }

export async function insertDocumentAssets({
  doc,
  blobs,
  insert,
  canEdit,
  flush,
  requestSave,
  signal,
  isAlive = () => !doc.isDestroyed,
}: Omit<InsertDocumentAssetOptions, 'blob' | 'insert'> & {
  blobs: ReadonlyArray<Blob>
  insert: (descriptors: ReadonlyArray<AssetDescriptor>) => void
}): Promise<AssetInsertionOutcome> {
  const ensureEditable = () => {
    signal?.throwIfAborted()
    if (!isAlive()) throw new AssetInsertionError('closed')
    if (!canEdit()) throw new AssetInsertionError('read-only')
  }
  ensureEditable()
  const repository = documentAssets(doc)
  if (!repository) throw new AssetInsertionError('storage-unavailable')
  const descriptors: AssetDescriptor[] = []
  for (const blob of blobs) {
    descriptors.push(await repository.put(blob, signal))
    ensureEditable()
  }
  if (repository.closed || documentAssets(doc) !== repository)
    throw new AssetInsertionError('closed')
  // The caller must use a discrete editor update so its binding synchronizes
  // before this transaction ends and before persistence is flushed.
  doc.transact(() => insert(descriptors))
  try {
    await flush()
    requestSave()
    return { status: 'inserted', descriptors }
  } catch (error) {
    // The visible edit and its bytes already exist; never retry the insertion.
    requestSave()
    return { status: 'durability-failed', descriptors, error }
  }
}

export type AssetFailureKind =
  | 'missing'
  | 'offline'
  | 'authentication'
  | 'permission'
  | 'corruption'
  | 'cancelled'
  | 'unknown'

export interface AssetFailure {
  kind: AssetFailureKind
  error?: unknown
}

export type AssetResolution =
  | {
      state: 'unresolved' | 'checking-local' | 'waiting-for-remote' | 'fetching'
    }
  | { state: 'available'; blob: Blob }
  | { state: 'unavailable'; cause: AssetFailure }

export interface DocumentAssetResolver {
  getState: (id: AssetId) => AssetResolution
  subscribe: (
    id: AssetId,
    listener: (state: AssetResolution) => void,
  ) => () => void
  resolve: (id: AssetId) => Promise<AssetResolution>
  retry: () => Promise<void>
  close: () => void
}

export interface AssetResolverOptions {
  repository: AssetRepository
  recover?: (signal: AbortSignal) => Promise<void>
  classifyFailure?: (error: unknown) => AssetFailure
}

function defaultFailure(error: unknown): AssetFailure {
  if (error instanceof Error && error.name === 'AbortError')
    return { kind: 'cancelled', error }
  return { kind: 'unknown', error }
}

export function createDocumentAssetResolver({
  repository,
  recover,
  classifyFailure = defaultFailure,
}: AssetResolverOptions): DocumentAssetResolver {
  const states = new Map<AssetId, AssetResolution>()
  const listeners = new Map<AssetId, Set<(state: AssetResolution) => void>>()
  const checking = new Map<AssetId, Promise<AssetResolution>>()
  const missing = new Set<AssetId>()
  const lifetime = new AbortController()
  let reconciliation: Promise<void> | undefined
  let closed = false

  const state = (id: AssetId): AssetResolution =>
    states.get(id) ?? { state: 'unresolved' }
  const update = (id: AssetId, value: AssetResolution) => {
    if (closed) return
    states.set(id, value)
    listeners.get(id)?.forEach((listener) => {
      try {
        listener(value)
      } catch {}
    })
  }
  const checkLocal = async (id: AssetId) => {
    const blob = await repository.get(id, lifetime.signal)
    if (closed) return false
    if (blob) {
      missing.delete(id)
      update(id, { state: 'available', blob })
      return true
    }
    return false
  }
  const reconcile = () => {
    if (reconciliation) return reconciliation
    const task = (async () => {
      // All references waiting in this turn share a single whole-document fetch.
      await Promise.resolve()
      if (closed || !missing.size) return
      if (!recover) {
        missing.forEach((id) =>
          update(id, {
            state: 'unavailable',
            cause: { kind: 'missing' },
          }),
        )
        return
      }
      missing.forEach((id) => update(id, { state: 'fetching' }))
      let failure: AssetFailure | undefined
      try {
        await recover(lifetime.signal)
      } catch (error) {
        failure = classifyFailure(error)
      }
      if (lifetime.signal.aborted) return
      await Promise.all(
        [...missing].map(async (id) => {
          try {
            if (!(await checkLocal(id)))
              update(id, {
                state: 'unavailable',
                cause: failure ?? { kind: 'missing' },
              })
          } catch (error) {
            update(id, { state: 'unavailable', cause: classifyFailure(error) })
          }
        }),
      )
    })()
    reconciliation = task
    void task
      .finally(() => {
        if (reconciliation === task) reconciliation = undefined
      })
      .catch(() => {})
    return task
  }
  const resolve = (id: AssetId): Promise<AssetResolution> => {
    if (closed)
      return Promise.resolve({
        state: 'unavailable',
        cause: { kind: 'cancelled' },
      })
    const existing = checking.get(id)
    if (existing) return existing
    const task = (async () => {
      update(id, { state: 'checking-local' })
      try {
        if (await checkLocal(id)) return state(id)
        missing.add(id)
        update(id, { state: 'waiting-for-remote' })
        await reconcile()
        return state(id)
      } catch (error) {
        const result: AssetResolution = {
          state: 'unavailable',
          cause: classifyFailure(error),
        }
        update(id, result)
        return result
      }
    })()
    checking.set(id, task)
    void task
      .finally(() => {
        if (checking.get(id) === task) checking.delete(id)
      })
      .catch(() => {})
    return task
  }
  const stop = repository.subscribe((id) => {
    if (!states.has(id) && !listeners.has(id)) return
    void checkLocal(id).catch((error: unknown) => {
      update(id, { state: 'unavailable', cause: classifyFailure(error) })
    })
  })
  return {
    getState: state,
    subscribe(id, listener) {
      if (closed) return () => {}
      const callbacks = listeners.get(id) ?? new Set()
      listeners.set(id, callbacks)
      callbacks.add(listener)
      listener(state(id))
      void resolve(id)
      return () => {
        callbacks.delete(listener)
        if (!callbacks.size) listeners.delete(id)
      }
    },
    resolve,
    async retry() {
      await Promise.all(
        [...states]
          .filter(([, value]) => value.state !== 'available')
          .map(([id]) => resolve(id)),
      )
    },
    close() {
      closed = true
      lifetime.abort()
      stop()
      listeners.clear()
      states.clear()
      missing.clear()
    },
  }
}

export function createAssetObjectUrl(blob: Blob) {
  const url = URL.createObjectURL(blob)
  let disposed = false
  return {
    url,
    dispose() {
      if (disposed) return
      disposed = true
      URL.revokeObjectURL(url)
    },
  }
}
