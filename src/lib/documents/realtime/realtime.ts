import type { Doc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { DocumentCapabilities } from './capabilities'

/**
 * Storage-agnostic document handle. Today only Google Drive documents have a
 * realtime channel; local-library documents stay single-player.
 */
export interface RealtimeHandle {
  storage: 'google-drive'
  fileId: string
}

export function isRealtimeHandle(value: unknown): value is RealtimeHandle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const handle = value as Record<string, unknown>
  return (
    handle.storage === 'google-drive' &&
    typeof handle.fileId === 'string' &&
    handle.fileId.length > 0
  )
}

export type RealtimeConnectionStatus =
  'connecting' | 'connected' | 'disconnected' | 'revoked' | 'disabled'

export interface RealtimeCollaborator {
  clientID: number
  /** The local user is listed first with `self: true`. */
  self: boolean
  name?: string
  color?: string
  avatar?: string
  focusing: boolean
}

export interface RealtimeState {
  status: RealtimeConnectionStatus
  capabilities?: DocumentCapabilities
  peers: number
  /** Connected users, including the local user, when the provider exposes them. */
  collaborators?: RealtimeCollaborator[]
}

/**
 * Provider-agnostic realtime channel, sitting next to `LocalProvider` and
 * `PublicationTransport`. The realtime layer is an optional accelerator: it
 * never writes to Drive and never acknowledges revisions.
 */
export interface RealtimeProvider {
  readonly handle: RealtimeHandle
  /** Yjs awareness (presence, cursors, selections) for admitted users. */
  readonly awareness: Awareness
  connect: () => void
  disconnect: () => void
  close: () => void
  /** Binds the provider to a document; incoming updates are applied to it. */
  attach: (doc: Doc) => void
  detach: () => void
  /** Forwards a fresh Drive capability snapshot (accelerates revalidation). */
  sendCapabilities: (capabilities: DocumentCapabilities) => void
  /** Hints that this client just persisted to Drive (permissions may have changed). */
  notifyPublication: () => void
  subscribe: (listener: () => void) => () => void
  getState: () => RealtimeState
}
