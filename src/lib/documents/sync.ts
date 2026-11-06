import { RealtimeClient, realtimeOrigin } from '../realtime/client'
import { accessTiming, canEditLocally } from './access'
import type { DocumentAccess } from './access'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import { toast } from 'sonner'
import {
  snapshotRevision,
  writePackage,
  PackageValidationError,
} from './package'
import {
  captureSnapshot,
  captureRevisionSnapshot,
  documentAssets,
  IncompleteAssetsError,
} from './working'
import { assetRetryPolicy } from './limits'
import { collectReferences } from './references'
import { readConcept, decodeUpdate, parseConcept } from './concept-file'

import { localDocumentStorage } from './storage'
import type { DocumentInfo, DocumentPersistence } from './storage'
import {
  getGoogleDriveAccountId,
  GoogleDriveAuthError,
  isGoogleDriveAuthError,
  isGoogleDriveConnected,
  subscribeGoogleDriveAuth,
} from './drive/auth'
import {
  DriveError,
  assertDriveFileReadable,
  getFileMetadata,
  getDriveResourceKey,
  isDriveFileReadOnly,
  readConceptFile,
  updateConceptFile,
} from './drive/api'
import { createDocumentAssetResolver } from './asset-session'
import type { DocumentAssetResolver } from './asset-session'
import type { PublicationTransport } from './publication'
import type { DriveFileVersion } from './drive/api'

export const assetReconciliation = assetRetryPolicy

export const saveTiming = { idleMs: 3000, maxWaitMs: 60_000 }
export const publicationCheckTiming = { idleMs: 30_000, missingAssetsMs: 5000 }

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
    | 'missing-assets'
  lastSyncedAt?: number
  etag?: string
  remoteRevision?: string
  revision?: string
  size?: number
  error?: string
  offlineAvailable?: boolean
  readOnly?: boolean
  access?: DocumentAccess
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
export function clearSaveStatus(id: string) {
  if (statuses.delete(id)) listeners.forEach((listener) => listener())
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
  realtime?: RealtimeClient
  assets?: DocumentAssetResolver
  access: DocumentAccess = { kind: 'local' }
  private permissionTimer?: ReturnType<typeof setInterval>
  private backgroundStatus: SaveStatus = { phase: 'loading' }
  private stopped = false
  private running?: Promise<void>
  private idle?: ReturnType<typeof setTimeout>
  private deadline?: ReturnType<typeof setTimeout>
  private initialized = false
  private accessEpoch = 0
  private version = 0
  private dirty = false
  private localDirty = false
  private localVersion = 0
  private dirtySince?: number
  private importingRemote = false
  private publicationTimer?: ReturnType<typeof setTimeout>
  private lastReconciledAt = 0
  private etag?: string
  private acknowledged?: string
  private remoteFilename?: string
  private retryCount = 0
  private metadataVersion = 0
  private unsubscribePublication?: () => void
  private unsubscribeAssets?: () => void
  private missingTimer?: ReturnType<typeof setTimeout>
  private missingAttempts = 0
  private waitingForAssets = false
  private actionRecovery = 0
  private urgent = false
  private reconcileAgain = false
  private unsubscribeAuth?: () => void
  private readonly abort = new AbortController()
  private isStopped = () => this.stopped

  get isReadOnly() {
    return (
      !canEditLocally(this.access) ||
      Boolean(this.info.readOnly || this.info.drive?.readOnly)
    )
  }

  constructor(
    readonly info: DocumentInfo,
    readonly doc: Doc,
    private persistence: DocumentPersistence,
    private publication?: PublicationTransport,
    private background = false,
  ) {
    this.access = info.drive
      ? {
          kind: 'unverified',
          previous: info.readOnly || info.drive.readOnly ? 'viewer' : 'editor',
          reason: 'temporary',
        }
      : { kind: 'local' }
    this.dirty = info.drive?.dirty ?? false
    this.localDirty = this.dirty
    if (this.dirty) this.dirtySince = Date.now()
    this.etag = info.drive?.etag
    this.remoteFilename = info.drive?.remoteFilename
    this.setStatus({
      phase: 'loading',
      offlineAvailable: info.drive?.offlineAvailable,
      lastSyncedAt: info.drive?.lastSyncedAt,
      readOnly: this.isReadOnly,
    })
  }

  private get saveStatus() {
    return this.background ? this.backgroundStatus : getSaveStatus(this.info.id)
  }

  private setStatus(status: SaveStatus) {
    status = { ...status, access: this.access }
    if (this.background) this.backgroundStatus = status
    else setSaveStatus(this.info.id, status)
  }

  private content() {
    return captureRevisionSnapshot(
      documentName(this.doc, this.info.name),
      this.doc,
    )
  }

  private async differsFrom(revision: string) {
    const generation = this.version
    const current = await snapshotRevision(await this.content())
    return generation !== this.version || current !== revision
  }

  private publish(phase: SaveStatus['phase'], error?: string) {
    if (this.isStopped()) return
    const status = {
      ...this.saveStatus,
      phase,
      error,
      etag: this.etag,
      readOnly: this.isReadOnly,
    }
    this.setStatus(status)
    if (
      phase === 'loading' ||
      phase === 'saving' ||
      phase === 'pending' ||
      phase === 'reconciling'
    )
      return
    const version = ++this.metadataVersion
    const content = this.content()
    void content
      .then(async (snapshot) => ({
        revision: await snapshotRevision(snapshot),
        size:
          snapshot.update.byteLength +
          snapshot.assets.reduce(
            (size, asset) => size + asset.descriptor.byteLength,
            0,
          ),
      }))
      .then(({ revision, size }) => {
        if (this.stopped || version !== this.metadataVersion) return
        this.setStatus({
          ...this.saveStatus,
          size,
          revision,
        })
      })
      .catch(() => {})
  }

  async start() {
    if (this.info.drive)
      this.unsubscribeAuth = subscribeGoogleDriveAuth(() => {
        if (this.info.drive?.accountId !== getGoogleDriveAccountId()) {
          this.fail(
            new DriveError(
              404,
              'This document belongs to a different Google account.',
            ),
            false,
          )
        } else if (isGoogleDriveConnected()) {
          if (this.initialized) this.check()
        } else this.fail(new GoogleDriveAuthError(), false)
      })

    if (this.info.drive) {
      const hasCachedContent =
        this.doc.share.has('root') &&
        encodeStateAsUpdate(this.doc).byteLength > 2
      if (
        hasCachedContent &&
        (!this.info.drive.savedRevision ||
          (await snapshotRevision(await this.content())) !==
            this.info.drive.savedRevision)
      ) {
        this.dirty = true
        this.localDirty = true
        this.dirtySince ??= Date.now()
        await this.persistMetadata()
      }
      try {
        await this.download()
      } catch (error) {
        this.fail(error, false)
        if (
          this.access.kind === 'unavailable' ||
          !(this.info.drive.offlineAvailable || this.dirty) ||
          !hasCachedContent
        )
          throw error
      }
    } else if (
      this.doc.getMap<string>('metadata').get('name') !== this.info.name
    ) {
      this.doc.getMap<string>('metadata').set('name', this.info.name)
    }
    if (this.isStopped()) return
    const repository = documentAssets(this.doc)
    if (repository)
      this.assets = createDocumentAssetResolver({
        repository,
        recover: this.info.drive
          ? async () => {
              await this.sync(true)
              const status = this.saveStatus
              if (status.phase === 'auth-required')
                throw new GoogleDriveAuthError()
              if (status.phase === 'error' || status.phase === 'offline')
                throw new Error(
                  status.error ?? 'Could not retrieve document assets.',
                )
            }
          : undefined,
        classifyFailure: (error) => ({
          kind: isGoogleDriveAuthError(error)
            ? 'authentication'
            : error instanceof DriveError && error.status === 403
              ? 'permission'
              : error instanceof PackageValidationError
                ? 'corruption'
                : error instanceof Error && error.name === 'AbortError'
                  ? 'cancelled'
                  : !navigator.onLine
                    ? 'offline'
                    : 'unknown',
          error,
        }),
      })
    this.initialized = true
    this.startRealtime()
    this.doc.on('update', this.changed)
    this.unsubscribeAssets = documentAssets(this.doc)?.subscribe(() => {
      if (this.isStopped() || this.importingRemote) return
      this.changed()
      this.requestUrgentSave()
    })
    this.unsubscribePublication = this.publication?.subscribe((hint) => {
      if (hint.validator === this.etag) return
      if (this.info.drive && isGoogleDriveConnected()) this.publicationHint()
    })
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.scheduleMissingCheck()
    if (!this.info.drive) {
      await this.persistence.flush?.()
      this.publish('local')
    } else if (this.dirty && !this.isReadOnly) this.schedule()
    if (this.info.drive)
      this.permissionTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') {
          if (
            this.dirty &&
            this.dirtySince !== undefined &&
            Date.now() >= this.dirtySince + saveTiming.maxWaitMs
          ) {
            void this.sync()
          } else if (
            this.publicationTimer &&
            Date.now() >= this.publicationDeadline()
          ) {
            void this.sync(true, true)
          } else if (this.dirty) void this.refreshAccess()
          else this.check()
        }
      }, accessTiming.refreshMs)
    window.addEventListener('focus', this.check)
    window.addEventListener('online', this.check)
    if (!this.background) documentSessions.set(this.info.id, this)
  }

  private changed = (_update?: Uint8Array, origin?: unknown) => {
    ++this.version
    if (this.isReadOnly) {
      this.scheduleMissingCheck()
      return
    }
    const wasDirty = this.dirty
    this.dirty = true
    this.dirtySince ??= Date.now()
    if (origin !== realtimeOrigin) {
      this.localDirty = true
      ++this.localVersion
    }
    if (!this.info.drive) {
      const version = this.version
      this.publish('saving')
      void this.persistence
        .flush?.()
        .then(() => {
          if (version === this.version) {
            this.dirty = false
            this.publish('local')
          }
        })
        .catch((error: unknown) => this.fail(error))
      return
    }
    const nextName = documentName(this.doc, this.info.name)
    if (!wasDirty || nextName !== this.info.name) {
      this.info.name = nextName
      void this.persistMetadata().catch((error: unknown) => this.fail(error))
    }
    if (!this.running) this.publish('pending')
    this.schedule(origin !== realtimeOrigin)
    this.scheduleMissingCheck()
  }

  private async persistMetadata(
    drive?: Partial<NonNullable<DocumentInfo['drive']>>,
  ) {
    await this.persistence.flush?.()
    const nextName = documentName(this.doc, this.info.name)
    this.info.name = nextName
    return localDocumentStorage.patch(this.info.id, (current) => ({
      ...current,
      name: documentName(this.doc, current.name),
      updatedAt: Date.now(),
      readOnly: this.info.readOnly ?? current.readOnly,
      drive: current.drive
        ? {
            ...current.drive,
            dirty: this.dirty,
            quarantined:
              this.info.drive?.quarantined ?? current.drive.quarantined,
            etag: this.etag,
            remoteFilename: this.remoteFilename,
            readOnly: this.info.drive?.readOnly ?? current.drive.readOnly,
            ...drive,
          }
        : undefined,
    }))
  }

  private publishSyncState() {
    if (this.dirty && this.isReadOnly) {
      const message =
        'Unsynced changes are preserved in this browser. Make a copy to keep editing this view-only document.'
      const previous = this.saveStatus
      this.publish('error', message)
      if (previous.phase !== 'error' || previous.error !== message)
        toast.error(message, { id: `drive-sync:${this.info.id}` })
    } else this.publish(this.dirty ? 'pending' : 'synced')
  }

  private schedule(resetIdle = true) {
    if (this.stopped || !this.info.drive || this.isReadOnly) return
    if (this.localDirty && resetIdle) {
      clearTimeout(this.idle)
      this.idle = setTimeout(() => {
        void this.sync()
      }, saveTiming.idleMs)
    }
    this.deadline ??= setTimeout(
      () => {
        this.deadline = undefined
        void this.sync()
      },
      Math.max(
        0,
        (this.dirtySince ?? Date.now()) + saveTiming.maxWaitMs - Date.now(),
      ),
    )
  }

  private publicationDeadline() {
    return (
      this.lastReconciledAt +
      (this.waitingForAssets
        ? publicationCheckTiming.missingAssetsMs
        : publicationCheckTiming.idleMs)
    )
  }

  private publicationHint = () => {
    if (this.stopped || !this.info.drive || this.access.kind === 'unavailable')
      return
    clearTimeout(this.publicationTimer)
    this.publicationTimer = setTimeout(
      () => {
        this.publicationTimer = undefined
        if (!this.running) void this.sync(true, true)
      },
      Math.max(0, this.publicationDeadline() - Date.now()),
    )
  }

  private check = () => {
    void this.sync(true)
  }

  private async download(initial?: DriveFileVersion) {
    this.assertAccount()
    const epoch = ++this.accessEpoch
    this.lastReconciledAt = Date.now()
    const remote = await readConceptFile(
      this.info.drive!.fileId,
      this.abort.signal,
      initial,
    )
    if (this.isStopped() || epoch !== this.accessEpoch) return
    this.assertAccount()
    assertDriveFileReadable(remote.file)
    const parsed = await readConcept(
      typeof remote.content === 'string'
        ? new TextEncoder().encode(remote.content)
        : remote.content,
    )
    this.assertAccount()
    if (parsed.kind !== 'complete')
      throw new IncompleteAssetsError(parsed.missingAssets)
    const incoming = parsed.snapshot
    this.importingRemote = true
    try {
      await documentAssets(this.doc)?.importAssets(
        incoming.assets,
        this.abort.signal,
      )
    } finally {
      this.importingRemote = false
    }
    if (this.isStopped() || epoch !== this.accessEpoch) return
    this.assertAccount()
    // Canonicalize the remote snapshot separately: local edits must never become
    // acknowledged merely because they were present when a download completed.
    const snapshot = new Doc()
    try {
      applyUpdate(snapshot, incoming.update)
      const embeddedName = incoming.name
      const remoteName = remote.file.name.replace(/\.concept$/i, '')
      const previousName = this.remoteFilename?.replace(/\.concept$/i, '')
      const localName = documentName(this.doc, this.info.name)
      const name =
        previousName !== undefined &&
        localName !== previousName &&
        remoteName === previousName
          ? localName
          : remoteName
      applyUpdate(this.doc, incoming.update, realtimeOrigin)
      if (this.doc.getMap<string>('metadata').get('name') !== name) {
        this.doc.transact(
          () => this.doc.getMap<string>('metadata').set('name', name),
          realtimeOrigin,
        )
        snapshot.getMap<string>('metadata').set('name', name)
      }
      this.acknowledged = await snapshotRevision({
        ...incoming,
        name: documentName(snapshot, embeddedName),
        update: encodeStateAsUpdate(snapshot),
      })
      if (epoch !== this.accessEpoch || this.stopped) return
      this.remoteFilename = remote.file.name
      this.etag = remote.etag
      this.assertAccount()
      this.observeAccess(isDriveFileReadOnly(remote.file))
      const generation = this.version
      this.dirty = await this.differsFrom(this.acknowledged)
      this.dirty ||= generation !== this.version
      if (!this.dirty) {
        this.localDirty = false
        this.dirtySince = undefined
      }
      const lastSyncedAt = this.dirty ? undefined : Date.now()
      const savedRevision = this.dirty ? undefined : this.acknowledged
      const info = await this.persistMetadata(
        this.dirty
          ? undefined
          : {
              lastSyncedAt,
              savedRevision,
              readOnly: this.info.drive?.readOnly,
            },
      )
      this.setStatus({
        ...this.saveStatus,
        ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
        remoteRevision: remote.file.headRevisionId ?? remote.file.version,
        offlineAvailable: info.drive?.offlineAvailable,
        readOnly: this.isReadOnly,
      })
      this.publishSyncState()
    } finally {
      snapshot.destroy()
    }
  }

  private startRealtime() {
    if (
      !this.background &&
      !this.realtime &&
      this.info.drive &&
      (this.access.kind === 'editor' || this.access.kind === 'viewer')
    ) {
      this.realtime = new RealtimeClient({
        doc: this.doc,
        fileId: this.info.drive.fileId,
        accountId: this.info.drive.accountId,
        resourceKey:
          this.info.drive.resourceKey ??
          getDriveResourceKey(this.info.drive.fileId),
        canWrite: () =>
          this.access.kind === 'editor' &&
          this.info.drive?.accountId === getGoogleDriveAccountId() &&
          !this.info.drive?.quarantined,
        onPublication: this.publicationHint,
        onAccess: () => this.sync(true),
      })
      this.realtime.start()
    }
  }

  private assertAccount() {
    if (
      this.info.drive &&
      this.info.drive.accountId !== getGoogleDriveAccountId()
    )
      throw new DriveError(
        404,
        'This document belongs to a different Google account.',
      )
  }

  private async refreshAccess() {
    if (this.running || this.access.kind === 'unavailable') return
    const epoch = ++this.accessEpoch
    try {
      this.assertAccount()
      const current = await getFileMetadata(
        this.info.drive!.fileId,
        this.abort.signal,
      )
      if (this.stopped || epoch !== this.accessEpoch) return
      this.assertAccount()
      assertDriveFileReadable(current.file)
      this.observeAccess(isDriveFileReadOnly(current.file))
      this.setStatus({ ...this.saveStatus, readOnly: this.isReadOnly })
    } catch (error) {
      if (epoch === this.accessEpoch) this.fail(error, false)
    }
  }

  private observeAccess(readOnly: boolean) {
    if (this.access.kind === 'unavailable') return
    const previous = this.access.kind
    this.access = {
      kind: readOnly ? 'viewer' : 'editor',
      checkedAt: Date.now(),
    }
    if (previous === 'unverified') this.realtime?.start()
    this.info.readOnly = readOnly || Boolean(this.info.drive?.quarantined)
    if (this.info.drive) this.info.drive.readOnly = this.info.readOnly
    if (readOnly) {
      if (previous === 'editor') {
        this.realtime?.stop()
        this.realtime?.start()
      }
      if (this.dirty && this.info.drive) this.info.drive.quarantined = true
      clearTimeout(this.idle)
      clearTimeout(this.deadline)
      this.deadline = undefined
      this.urgent = false
    }
    if (this.initialized) this.startRealtime()
  }

  sync(checkRemote = false, deferRemoteSave = false): Promise<void> {
    if (this.running) {
      if (checkRemote) this.reconcileAgain = true
      return this.running
    }
    if (this.stopped || !this.info.drive || (!this.dirty && !checkRemote))
      return Promise.resolve()
    if (checkRemote) {
      this.lastReconciledAt = Date.now()
      clearTimeout(this.publicationTimer)
      this.publicationTimer = undefined
    }
    clearTimeout(this.idle)
    clearTimeout(this.deadline)
    this.deadline = undefined
    this.running = this.run(checkRemote, deferRemoteSave)
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.running = undefined
        if (!this.stopped && (this.urgent || this.reconcileAgain)) {
          const check = this.reconcileAgain
          this.urgent = false
          this.reconcileAgain = false
          void this.sync(check)
          return
        }
        this.scheduleMissingCheck()
        if (this.dirty && !this.stopped && this.saveStatus.phase === 'pending')
          this.schedule()
      })
    return this.running
  }

  private canPublish() {
    return (
      !this.stopped &&
      !this.isReadOnly &&
      this.access.kind === 'editor' &&
      this.info.drive?.accountId === getGoogleDriveAccountId() &&
      !this.info.drive?.quarantined
    )
  }

  private async run(checkRemote: boolean, deferRemoteSave: boolean) {
    this.assertAccount()
    if (checkRemote || this.dirty || !this.etag) {
      const epoch = ++this.accessEpoch
      const current =
        this.etag && this.acknowledged
          ? await getFileMetadata(this.info.drive!.fileId, this.abort.signal)
          : undefined
      if (epoch !== this.accessEpoch || this.stopped) return
      const permissionsChanged =
        current && isDriveFileReadOnly(current.file) !== this.isReadOnly
      if (current) {
        this.assertAccount()
        assertDriveFileReadable(current.file)
        this.observeAccess(isDriveFileReadOnly(current.file))
      }
      if (!current || current.etag !== this.etag || permissionsChanged) {
        this.publish('reconciling')
        await this.download(current)
      }
    }
    if (
      deferRemoteSave &&
      !this.localDirty &&
      this.dirty &&
      Date.now() < (this.dirtySince ?? Date.now()) + saveTiming.maxWaitMs
    ) {
      this.publishSyncState()
      return
    }
    for (
      let attempt = 0;
      this.dirty && !this.stopped && !this.isReadOnly;
      attempt++
    ) {
      if (attempt === 5)
        throw new Error('Drive keeps changing. Try syncing again.')
      this.publish('saving')
      await this.persistence.flush?.()
      const localGeneration = this.localVersion
      let snapshot
      try {
        snapshot = await captureSnapshot(
          documentName(this.doc, this.info.name),
          this.doc,
        )
      } catch (error) {
        if (!(error instanceof IncompleteAssetsError)) throw error
        this.waitingForAssets = true
        this.publish('reconciling')
        await this.download()
        snapshot = await captureSnapshot(
          documentName(this.doc, this.info.name),
          this.doc,
        )
      }
      if (this.isStopped()) return
      const revision = await snapshotRevision(snapshot)
      if (this.isStopped()) return
      if (revision === this.acknowledged) {
        const generation = this.version
        this.dirty = await this.differsFrom(revision)
        this.dirty ||= generation !== this.version
        if (this.dirty) continue
        break
      }
      try {
        const content = await writePackage(snapshot, {
          signal: this.abort.signal,
        })
        if (!this.canPublish()) return
        const name = snapshot.name
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
        if (!this.canPublish()) return
        this.etag = remote.etag
        this.remoteFilename = remote.file.name
        this.acknowledged = revision
        this.realtime?.publish()
        this.publication?.publish({
          protocol: 1,
          storage: 'google-drive',
          fileId: this.info.drive!.fileId,
          validator: remote.etag,
          revision,
        })
        const generation = this.version
        this.dirty = await this.differsFrom(revision)
        this.dirty ||= generation !== this.version
        if (localGeneration === this.localVersion) this.localDirty = false
        this.dirtySince = this.dirty ? Date.now() : undefined
        this.retryCount = 0
        const lastSyncedAt = Date.now()
        const savedRevision = revision
        const remoteRevision = remote.file.headRevisionId ?? remote.file.version
        await this.persistMetadata({
          lastSyncedAt,
          savedRevision,
          revision: remoteRevision,
        })
        this.setStatus({
          ...this.saveStatus,
          lastSyncedAt,
          remoteRevision,
        })
        this.publishSyncState()
        return
      } catch (error) {
        if (!(error instanceof DriveError) || error.status !== 412) throw error
        this.publish('reconciling')
        await this.download()
      }
    }
    if (!this.stopped) {
      await this.persistMetadata()
      this.publishSyncState()
    }
  }

  private fail(error: unknown, notify = true) {
    notify &&= this.actionRecovery === 0
    if (this.info.drive) {
      ++this.accessEpoch
      const unavailable =
        error instanceof DriveError &&
        (error.status === 404 ||
          (error.status === 403 &&
            error.reason !== 'rateLimitExceeded' &&
            error.reason !== 'userRateLimitExceeded' &&
            error.reason !== 'dailyLimitExceeded'))
      if (unavailable) {
        this.access = { kind: 'unavailable', checkedAt: Date.now() }
        this.info.readOnly = true
        this.info.drive.readOnly = true
        if (this.dirty) this.info.drive.quarantined = true
        void this.persistMetadata().catch(() => {})
        this.urgent = false
        clearTimeout(this.idle)
        clearTimeout(this.deadline)
        this.realtime?.stop()
        this.assets?.close()
      } else if (this.access.kind !== 'unavailable') {
        this.realtime?.stop()
        this.access = {
          kind: 'unverified',
          previous:
            this.info.readOnly || this.info.drive.readOnly
              ? 'viewer'
              : 'editor',
          reason: isGoogleDriveAuthError(error)
            ? 'authentication'
            : !navigator.onLine
              ? 'offline'
              : 'temporary',
        }
      }
    }
    if (error instanceof IncompleteAssetsError) {
      this.waitingForAssets = true
      this.publish('missing-assets')
      void this.persistMetadata().catch(() => {})
      this.scheduleMissingCheck()
      return
    }
    const message =
      error instanceof Error ? error.message : 'Could not save changes.'
    const auth =
      isGoogleDriveAuthError(error) ||
      (error instanceof DriveError && error.status === 401)
    const renameFailed =
      Boolean(this.remoteFilename) &&
      documentName(this.doc, this.info.name) !==
        this.remoteFilename!.replace(/\.concept$/i, '')
    if (!this.stopped) {
      if (renameFailed) {
        if (
          notify &&
          !auth &&
          (typeof navigator === 'undefined' || navigator.onLine)
        )
          toast.error('Could not rename the file on Google Drive.', {
            id: `drive-rename:${this.info.id}`,
          })
      } else if (
        notify &&
        !auth &&
        (typeof navigator === 'undefined' || navigator.onLine)
      )
        toast.error(message, {
          id: `drive-sync:${this.info.id}`,
        })
    }
    this.publish(
      auth ? 'auth-required' : !navigator.onLine ? 'offline' : 'error',
      message,
    )
    const retryable =
      !auth &&
      (!(error instanceof DriveError) ||
        error.status === 429 ||
        error.status >= 500)
    if (
      retryable &&
      !this.stopped &&
      this.info.drive &&
      !this.waitingForAssets
    ) {
      clearTimeout(this.idle)
      this.idle = setTimeout(
        () => {
          void this.sync(true)
        },
        Math.min(60_000, 1000 * 2 ** Math.min(this.retryCount++, 6)),
      )
    }
  }

  requestUrgentSave() {
    if (this.stopped || this.isReadOnly) return
    this.dirty = true
    this.localDirty = true
    this.dirtySince ??= Date.now()
    if (this.running) this.urgent = true
    else void this.sync()
  }

  async recoverAssets() {
    try {
      await captureSnapshot(documentName(this.doc, this.info.name), this.doc)
    } catch (error) {
      if (!(error instanceof IncompleteAssetsError) || !this.info.drive)
        throw error
      this.actionRecovery++
      try {
        await this.sync(true)
        await captureSnapshot(documentName(this.doc, this.info.name), this.doc)
      } finally {
        this.actionRecovery--
      }
    }
  }

  private visibilityChanged = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(this.missingTimer)
      this.missingTimer = undefined
    } else {
      this.missingAttempts = 0
      this.check()
      this.scheduleMissingCheck()
    }
  }

  private scheduleMissingCheck() {
    if (
      this.stopped ||
      !this.info.drive ||
      this.missingTimer ||
      !navigator.onLine ||
      document.visibilityState === 'hidden'
    )
      return
    let required
    try {
      required = collectReferences(encodeStateAsUpdate(this.doc))
    } catch {
      return
    }
    void documentAssets(this.doc)
      ?.list()
      .then((assets) => {
        if (
          this.stopped ||
          this.missingTimer ||
          !navigator.onLine ||
          document.visibilityState === 'hidden'
        )
          return
        const available = new Set(assets.map((asset) => asset.id))
        const missing = [
          ...required,
          ...(this.info.recoveryMissingAssets ?? []),
        ].some((id) => !available.has(id))
        this.waitingForAssets = missing
        if (!missing) {
          this.missingAttempts = 0
          return
        }
        if (this.saveStatus.offlineAvailable)
          void this.setOfflineAvailable(false).catch(() => {})
        const delay = Math.min(
          assetReconciliation.maximumMs,
          assetReconciliation.initialMs *
            2 ** Math.min(this.missingAttempts++, 8),
        )
        this.missingTimer = setTimeout(
          () => {
            this.missingTimer = undefined
            if (navigator.onLine && document.visibilityState !== 'hidden')
              void this.sync(true)
          },
          delay * (1 + Math.random() * assetReconciliation.jitter),
        )
      })
      .catch((error: unknown) => this.fail(error))
  }

  async setOfflineAvailable(value: boolean) {
    if (value)
      await captureSnapshot(documentName(this.doc, this.info.name), this.doc)
    await this.persistence.flush?.()
    await localDocumentStorage.patch(this.info.id, (current) => ({
      ...current,
      drive: current.drive
        ? { ...current.drive, offlineAvailable: value }
        : undefined,
    }))
    this.setStatus({
      ...this.saveStatus,
      offlineAvailable: value,
    })
  }

  async stop() {
    if (this.isStopped()) return
    this.stopped = true
    this.abort.abort()
    this.realtime?.stop()
    clearTimeout(this.publicationTimer)
    clearInterval(this.permissionTimer)
    clearTimeout(this.idle)
    clearTimeout(this.deadline)
    this.doc.off('update', this.changed)
    this.unsubscribeAuth?.()
    this.unsubscribeAssets?.()
    this.assets?.close()
    this.unsubscribePublication?.()
    this.publication?.close()
    clearTimeout(this.missingTimer)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    window.removeEventListener('focus', this.check)
    window.removeEventListener('online', this.check)
    if (documentSessions.get(this.info.id) === this)
      documentSessions.delete(this.info.id)
    await this.running
    if (this.dirty)
      await (this.info.drive
        ? this.persistMetadata()
        : this.persistence.flush?.())
    if (
      !this.background &&
      !documentSessions.has(this.info.id) &&
      this.access.kind !== 'unavailable'
    )
      clearSaveStatus(this.info.id)
  }
}
