import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { toast } from 'sonner'
import { documentRevision } from './revision'
import { decodeUpdate, parseConcept } from './concept-file'
import { serializeConcept } from './serialization'
import { localDocumentStorage } from './storage'
import type { DocumentInfo, DocumentPersistence } from './storage'
import {
  GoogleDriveAuthError,
  isGoogleDriveAuthError,
  isGoogleDriveConnected,
  subscribeGoogleDriveAuth,
} from './drive/auth'
import { DriveError, readConceptFile, updateConceptFile } from './drive/api'

export const saveTiming = { idleMs: 3000, maxWaitMs: 60_000 }

export interface SaveStatus {
  phase:
    | 'loading'
    | 'local'
    | 'synced'
    | 'pending'
    | 'saving'
    | 'reconciling'
    | 'offline'
    | 'auth-required'
    | 'error'
  lastSyncedAt?: number
  etag?: string
  remoteRevision?: string
  revision?: string
  size?: number
  error?: string
  offlineAvailable?: boolean
}

const emptyStatus: SaveStatus = { phase: 'loading' }
const statuses = new Map<string, SaveStatus>()
const listeners = new Set<() => void>()
export const documentSessions = new Map<string, DocumentSync>()
export const subscribeSaveStatus = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const getSaveStatus = (id: string) => statuses.get(id) ?? emptyStatus
export function setSaveStatus(id: string, status: SaveStatus) {
  statuses.set(id, status)
  listeners.forEach((listener) => listener())
}

export function documentName(doc: Doc, fallback: string) {
  const name = doc.getMap<string>('metadata').get('name')
  return name?.trim() || fallback
}

export function mergeConcept(doc: Doc, content: string) {
  const file = parseConcept(content)
  applyUpdate(doc, decodeUpdate(file))
  return file.name
}

export class DocumentSync {
  private stopped = false
  private running?: Promise<void>
  private idle?: ReturnType<typeof setTimeout>
  private deadline?: ReturnType<typeof setTimeout>
  private version = 0
  private dirty = false
  private etag?: string
  private acknowledged?: string
  private remoteFilename?: string
  private retryCount = 0
  private metadataVersion = 0
  private unsubscribeAuth?: () => void
  private readonly abort = new AbortController()
  private isStopped = () => this.stopped

  constructor(
    readonly info: DocumentInfo,
    readonly doc: Doc,
    private persistence: DocumentPersistence,
  ) {
    this.dirty = info.drive?.dirty ?? false
    this.etag = info.drive?.etag
    this.remoteFilename = info.drive?.remoteFilename
    setSaveStatus(info.id, {
      phase: 'loading',
      offlineAvailable: info.drive?.offlineAvailable,
      lastSyncedAt: info.drive?.lastSyncedAt,
    })
  }

  private content() {
    return serializeConcept(documentName(this.doc, this.info.name), this.doc)
  }

  private publish(phase: SaveStatus['phase'], error?: string) {
    if (this.stopped) return
    const status = {
      ...getSaveStatus(this.info.id),
      phase,
      error,
      etag: this.etag,
    }
    setSaveStatus(this.info.id, status)
    const version = ++this.metadataVersion
    const content = this.content()
    const bytes = new TextEncoder().encode(content)
    void documentRevision(content).then((revision) => {
      if (this.stopped || version !== this.metadataVersion) return
      setSaveStatus(this.info.id, {
        ...getSaveStatus(this.info.id),
        size: bytes.byteLength,
        revision,
      })
    })
  }

  async start() {
    if (this.info.drive) {
      const hasCachedContent =
        this.doc.share.has('root') &&
        encodeStateAsUpdate(this.doc).byteLength > 2
      if (
        hasCachedContent &&
        (!this.info.drive.savedRevision ||
          (await documentRevision(this.content())) !==
            this.info.drive.savedRevision)
      ) {
        this.dirty = true
        await this.persistMetadata()
      }
      try {
        await this.download()
      } catch (error) {
        this.fail(error)
        if (
          !(this.info.drive.offlineAvailable || this.dirty) ||
          !hasCachedContent
        )
          throw error
      }
    }
    if (this.stopped) return
    this.doc.on('update', this.changed)
    if (this.info.drive)
      this.unsubscribeAuth = subscribeGoogleDriveAuth(() => {
        if (isGoogleDriveConnected()) this.check()
        else this.fail(new GoogleDriveAuthError())
      })
    if (!this.info.drive) {
      await this.persistence.flush?.()
      this.publish('local')
    } else if (this.dirty) this.schedule()
    window.addEventListener('focus', this.check)
    window.addEventListener('online', this.check)
    documentSessions.set(this.info.id, this)
  }

  private changed = () => {
    ++this.version
    this.dirty = true
    if (!this.info.drive) {
      const version = this.version
      this.publish('saving')
      void this.persistence
        .flush?.()
        .then(() => {
          if (version === this.version) this.publish('local')
        })
        .catch((error: unknown) => this.fail(error))
      return
    }
    void this.persistMetadata().catch((error: unknown) => this.fail(error))
    if (!this.running) this.publish('pending')
    this.schedule()
  }

  private async persistMetadata() {
    await this.persistence.flush?.()
    return localDocumentStorage.patch(this.info.id, (current) => ({
      ...current,
      name: documentName(this.doc, current.name),
      updatedAt: Date.now(),
      drive: current.drive
        ? {
            ...current.drive,
            dirty: this.dirty,
            etag: this.etag,
            remoteFilename: this.remoteFilename,
          }
        : undefined,
    }))
  }

  private schedule() {
    if (this.stopped || !this.info.drive) return
    clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      void this.sync()
    }, saveTiming.idleMs)
    this.deadline ??= setTimeout(() => {
      this.deadline = undefined
      void this.sync()
    }, saveTiming.maxWaitMs)
  }

  private check = () => {
    void this.sync(true)
  }

  private async download() {
    const remote = await readConceptFile(
      this.info.drive!.fileId,
      this.abort.signal,
    )
    if (this.stopped) return
    // Canonicalize the remote snapshot separately: local edits must never become
    // acknowledged merely because they were present when a download completed.
    const snapshot = new Doc()
    try {
      const embeddedName = mergeConcept(snapshot, remote.content)
      this.acknowledged = serializeConcept(
        documentName(snapshot, embeddedName),
        snapshot,
      )
      const remoteName = remote.file.name.replace(/\.concept$/i, '')
      const previousName = this.remoteFilename?.replace(/\.concept$/i, '')
      const localName = documentName(this.doc, this.info.name)
      const name =
        previousName !== undefined &&
        localName !== previousName &&
        remoteName === previousName
          ? localName
          : remoteName
      mergeConcept(this.doc, remote.content)
      if (this.doc.getMap<string>('metadata').get('name') !== name)
        this.doc.getMap<string>('metadata').set('name', name)
      this.remoteFilename = remote.file.name
      this.etag = remote.etag
      this.dirty = this.content() !== this.acknowledged
      const info = await this.persistMetadata()
      setSaveStatus(this.info.id, {
        ...getSaveStatus(this.info.id),
        remoteRevision: remote.file.headRevisionId ?? remote.file.version,
        offlineAvailable: info.drive?.offlineAvailable,
      })
      if (!this.dirty) {
        const lastSyncedAt = Date.now()
        const savedRevision = await documentRevision(this.acknowledged)
        await localDocumentStorage.patch(this.info.id, (current) => ({
          ...current,
          drive: current.drive
            ? { ...current.drive, lastSyncedAt, savedRevision }
            : undefined,
        }))
        setSaveStatus(this.info.id, {
          ...getSaveStatus(this.info.id),
          lastSyncedAt,
        })
      }
      this.publish(this.dirty ? 'pending' : 'synced')
    } finally {
      snapshot.destroy()
    }
  }

  sync(checkRemote = false): Promise<void> {
    if (this.running) return this.running
    if (this.stopped || !this.info.drive || (!this.dirty && !checkRemote))
      return Promise.resolve()
    clearTimeout(this.idle)
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.running = this.run(checkRemote)
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.running = undefined
        if (
          this.dirty &&
          !this.stopped &&
          getSaveStatus(this.info.id).phase === 'pending'
        )
          this.schedule()
      })
    return this.running
  }

  private async run(checkRemote: boolean) {
    if (checkRemote || !this.etag) {
      this.publish('reconciling')
      await this.download()
    }
    for (let attempt = 0; this.dirty && !this.stopped; attempt++) {
      if (attempt === 5)
        throw new Error('Drive keeps changing. Try syncing again.')
      this.publish('saving')
      await this.persistence.flush?.()
      const content = this.content()
      if (content === this.acknowledged) {
        this.dirty = false
        break
      }
      try {
        const name = documentName(this.doc, this.info.name)
        const filename =
          name === this.remoteFilename?.replace(/\.concept$/i, '')
            ? this.remoteFilename
            : undefined
        const remote = await updateConceptFile(
          this.info.drive!.fileId,
          name,
          content,
          this.etag!,
          filename,
          this.abort.signal,
        )
        if (this.isStopped()) return
        this.etag = remote.etag
        this.remoteFilename = remote.file.name
        this.acknowledged = content
        this.dirty = this.content() !== content
        this.retryCount = 0
        const lastSyncedAt = Date.now()
        const savedRevision = await documentRevision(content)
        await this.persistMetadata()
        await localDocumentStorage.patch(this.info.id, (current) => ({
          ...current,
          drive: current.drive
            ? {
                ...current.drive,
                lastSyncedAt,
                savedRevision,
                revision: remote.file.headRevisionId ?? remote.file.version,
              }
            : undefined,
        }))
        setSaveStatus(this.info.id, {
          ...getSaveStatus(this.info.id),
          lastSyncedAt,
          remoteRevision: remote.file.headRevisionId ?? remote.file.version,
        })
        this.publish(this.dirty ? 'pending' : 'synced')
        return
      } catch (error) {
        if (!(error instanceof DriveError) || error.status !== 412) throw error
        this.publish('reconciling')
        await this.download()
      }
    }
    if (!this.stopped) {
      await this.persistMetadata()
      this.publish(this.dirty ? 'pending' : 'synced')
    }
  }

  private fail(error: unknown) {
    if (
      !this.stopped &&
      this.remoteFilename &&
      documentName(this.doc, this.info.name) !==
        this.remoteFilename.replace(/\.concept$/i, '')
    )
      toast.error('Could not rename the file on Google Drive.', {
        id: `drive-rename:${this.info.id}`,
      })
    const auth =
      isGoogleDriveAuthError(error) ||
      (error instanceof DriveError && error.status === 401)
    this.publish(
      auth ? 'auth-required' : !navigator.onLine ? 'offline' : 'error',
      error instanceof Error ? error.message : 'Could not save changes.',
    )
    const retryable =
      !auth &&
      (!(error instanceof DriveError) ||
        error.status === 429 ||
        error.status >= 500)
    if (retryable && !this.stopped && this.info.drive) {
      clearTimeout(this.idle)
      this.idle = setTimeout(
        () => {
          void this.sync(true)
        },
        Math.min(60_000, 1000 * 2 ** Math.min(this.retryCount++, 6)),
      )
    }
  }

  async setOfflineAvailable(value: boolean) {
    await this.persistence.flush?.()
    await localDocumentStorage.patch(this.info.id, (current) => ({
      ...current,
      drive: current.drive
        ? { ...current.drive, offlineAvailable: value }
        : undefined,
    }))
    setSaveStatus(this.info.id, {
      ...getSaveStatus(this.info.id),
      offlineAvailable: value,
    })
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    clearTimeout(this.idle)
    clearTimeout(this.deadline)
    this.doc.off('update', this.changed)
    this.unsubscribeAuth?.()
    window.removeEventListener('focus', this.check)
    window.removeEventListener('online', this.check)
    if (documentSessions.get(this.info.id) === this)
      documentSessions.delete(this.info.id)
    await this.running
    if (this.info.drive && this.dirty) await this.persistMetadata()
  }
}
