import { Doc, mergeUpdates } from 'yjs'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { realtimePolicy } from './policy'
import {
  encodeControlMessage,
  parseServerControlMessage,
  realtimeProtocolVersion,
} from './protocol'
import type { DocumentCapabilities } from './capabilities'
import type {
  RealtimeCollaborator,
  RealtimeHandle,
  RealtimeProvider,
  RealtimeState,
} from './realtime'

/** y-protocols awareness messages start with this tag (not exported by y-protocols). */
const messageAwareness = 3

/** A ticket stops being reused this long before its actual expiry. */
const ticketReuseMarginMs = 60_000

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function collaboratorFromState(
  clientID: number,
  state: unknown,
  self: boolean,
): RealtimeCollaborator | undefined {
  const record = objectRecord(state)
  if (!record) return undefined
  const data = objectRecord(record.awarenessData)
  const name =
    typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : undefined
  const color = typeof record.color === 'string' ? record.color : undefined
  const avatar =
    typeof data?.avatar === 'string'
      ? data.avatar
      : typeof data?.image === 'string'
        ? data.image
        : undefined
  return {
    clientID,
    self,
    name,
    color,
    avatar,
    focusing: record.focusing === true,
  }
}

export interface WebSocketLike {
  binaryType: string
  send: (data: string | ArrayBuffer | Uint8Array) => void
  close: (code?: number, reason?: string) => void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose:
    | ((event: { code?: number; reason?: string; wasClean?: boolean }) => void)
    | null
  onerror: ((event: unknown) => void) | null
}

export interface RealtimeTicket {
  ticket: string
  /** Expiration time in milliseconds since the epoch. */
  expiresAt: number
  capabilities: DocumentCapabilities
}

export interface WebSocketRealtimeProviderDeps {
  fetchTicket?: (handle: RealtimeHandle) => Promise<RealtimeTicket>
  createSocket?: (url: string) => WebSocketLike
  now?: () => number
}

const defaultFetchTicket = async (
  handle: RealtimeHandle,
): Promise<RealtimeTicket> => {
  const response = await fetch(realtimePolicy.ticketEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storage: handle.storage, fileId: handle.fileId }),
  })
  if (!response.ok)
    throw new TicketRequestError(
      response.status,
      `Realtime ticket endpoint returned ${response.status}.`,
    )
  return (await response.json()) as RealtimeTicket
}

/**
 * A ticket request the server refused for a reason retrying cannot fix:
 * signed out (401), no Drive access (403), or realtime disabled (403).
 */
export class TicketRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TicketRequestError'
  }

  get permanent(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/**
 * Close codes the server uses for refusals that a retry cannot resolve. A 4401
 * is absent on purpose: it also fires for an expired or clock-skewed ticket, so
 * it earns one retry with a fresh ticket before the loop gives up.
 */
const permanentCloseCodes = new Set([4403])

/** Close code for an invalid or expired join ticket. */
const invalidTicketCloseCode = 4401

const defaultCreateSocket = (url: string): WebSocketLike => {
  if (typeof WebSocket === 'undefined')
    throw new Error('WebSocket is not available in this environment.')
  return new WebSocket(url) as unknown as WebSocketLike
}

const socketUrl = (handle: RealtimeHandle, ticket: string) => {
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:'
  const host = typeof location !== 'undefined' ? location.host : 'localhost'
  const protocol = secure ? 'wss://' : 'ws://'
  const query = `fileId=${encodeURIComponent(handle.fileId)}&ticket=${encodeURIComponent(ticket)}`
  return `${protocol}${host}${realtimePolicy.socketEndpoint}?${query}`
}

/**
 * WebSocket realtime provider for Drive documents. Google Drive remains the
 * only durable store: this channel only accelerates sync with y-protocols
 * updates and awareness. Every failure path is silent — `DocumentSync` owns
 * the user-facing UX.
 */
export class WebSocketRealtimeProvider implements RealtimeProvider {
  readonly awareness: Awareness
  private readonly fetchTicket: (
    handle: RealtimeHandle,
  ) => Promise<RealtimeTicket>
  private readonly createSocket: (url: string) => WebSocketLike
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private readonly awarenessDoc = new Doc()
  private doc?: Doc
  private socket?: WebSocketLike
  private ticket?: RealtimeTicket
  private state: RealtimeState = { status: 'disconnected', peers: 0 }
  private collaboratorsKey?: string
  private pendingUpdates: Uint8Array[] = []
  private readonly awarenessDirty = new Set<number>()
  private updateTimer?: ReturnType<typeof setInterval>
  private awarenessTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private backoff: number = realtimePolicy.reconnectBaseMs
  private connecting = false
  private connectionAttempt = 0
  private closed = false
  private selfInitiatedClose = false
  /** Guards the single fresh-ticket retry after an invalid-ticket close. */
  private ticketRetryUsed = false

  constructor(
    readonly handle: RealtimeHandle,
    deps: WebSocketRealtimeProviderDeps = {},
  ) {
    this.fetchTicket = deps.fetchTicket ?? defaultFetchTicket
    this.createSocket = deps.createSocket ?? defaultCreateSocket
    this.now = deps.now ?? (() => Date.now())
    this.awareness = new Awareness(this.awarenessDoc)
    this.awareness.on('update', this.awarenessChanged)
  }

  connect(): void {
    if (this.closed || this.connecting || this.socket) return
    // An explicit connect is a new session, so it gets a fresh retry budget.
    this.ticketRetryUsed = false
    void this.open()
  }

  disconnect(): void {
    // Invalidate any in-flight ticket fetch so a socket cannot open after the
    // user turned live collaboration off.
    this.connectionAttempt++
    this.connecting = false
    this.selfInitiatedClose = true
    this.clearReconnect()
    this.stopTimers()
    this.socket?.close()
    this.socket = undefined
    this.clearAwareness()
    this.setState({
      status: 'disconnected',
      capabilities: this.state.capabilities,
      peers: 0,
      collaborators: [],
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.connectionAttempt++
    this.selfInitiatedClose = true
    this.clearReconnect()
    this.stopTimers()
    this.detachDoc()
    this.socket?.close()
    this.socket = undefined
    this.listeners.clear()
    this.awareness.destroy()
    this.awarenessDoc.destroy()
  }

  attach(doc: Doc): void {
    if (this.doc === doc) return
    this.detachDoc()
    this.doc = doc
    doc.on('update', this.docUpdated)
    if (this.state.status === 'connected') this.startTimers()
  }

  detach(): void {
    this.detachDoc()
    this.pendingUpdates = []
    this.awarenessDirty.clear()
    this.stopTimers()
  }

  sendCapabilities(capabilities: DocumentCapabilities): void {
    if (this.state.status !== 'connected' || !this.socket) return
    this.socket.send(
      encodeControlMessage({ type: 'capabilities', capabilities }),
    )
  }

  notifyPublication(): void {
    if (this.state.status !== 'connected' || !this.socket) return
    this.socket.send(encodeControlMessage({ type: 'publication' }))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): RealtimeState {
    return { ...this.state }
  }

  /**
   * Drops every awareness state, including the local one, so a disabled session
   * stops advertising presence and the editor stops rendering stale cursors.
   */
  private clearAwareness() {
    const clients = [...this.awareness.getStates().keys()]
    this.awarenessDirty.clear()
    if (clients.length === 0) return
    removeAwarenessStates(this.awareness, clients, this)
    // y-protocols keeps the local state when its own client is removed.
    if (this.awareness.getLocalState() !== null)
      this.awareness.setLocalState(null)
  }

  private detachDoc() {
    this.doc?.off('update', this.docUpdated)
    this.doc = undefined
  }

  private docUpdated = (update: Uint8Array, origin: unknown) => {
    // Updates applied from the socket carry this provider as their origin.
    if (origin !== this) this.pendingUpdates.push(update)
  }

  private awarenessChanged = (
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    this.updatePeers()
    if (origin === this) return
    for (const client of [...added, ...updated, ...removed])
      this.awarenessDirty.add(client)
  }

  private updatePeers() {
    const collaborators: RealtimeCollaborator[] = []
    const local = collaboratorFromState(
      this.awareness.clientID,
      this.awareness.getLocalState(),
      true,
    )
    if (local) collaborators.push(local)
    for (const [clientID, state] of this.awareness.getStates()) {
      if (clientID === this.awareness.clientID) continue
      // Removed clients linger as null at runtime despite the declared type.
      const peer = collaboratorFromState(clientID, state, false)
      if (peer) collaborators.push(peer)
    }
    const peers = collaborators.filter(
      (collaborator) => !collaborator.self,
    ).length
    const key = JSON.stringify(collaborators)
    if (peers === this.state.peers && key === this.collaboratorsKey) return
    this.collaboratorsKey = key
    this.setState({ ...this.state, peers, collaborators })
  }

  private setState(state: RealtimeState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }

  private async open() {
    if (this.closed) return
    const attempt = ++this.connectionAttempt
    this.connecting = true
    this.setState({
      status: 'connecting',
      capabilities: this.state.capabilities,
      peers: 0,
      collaborators: [],
    })
    try {
      const ticket = await this.ensureTicket()
      if (attempt !== this.connectionAttempt) return
      this.openSocket(socketUrl(this.handle, ticket.ticket))
    } catch (error) {
      if (attempt !== this.connectionAttempt) return
      // A refused ticket will be refused again; stop instead of polling the
      // endpoint every backoff tick for as long as the tab stays open.
      if (error instanceof TicketRequestError && error.permanent) {
        this.connecting = false
        this.stopRetrying()
        return
      }
      // Silent: the Drive-only flow continues without realtime.
      this.handleConnectionFailure()
    } finally {
      if (attempt === this.connectionAttempt) this.connecting = false
    }
  }

  private async ensureTicket(): Promise<RealtimeTicket> {
    if (
      this.ticket &&
      this.ticket.expiresAt - this.now() >= ticketReuseMarginMs
    )
      return this.ticket
    this.ticket = await this.fetchTicket(this.handle)
    return this.ticket
  }

  private openSocket(url: string) {
    if (this.closed) return
    this.selfInitiatedClose = false
    const socket = this.createSocket(url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onopen = () => {
      if (this.ticket)
        socket.send(
          encodeControlMessage({
            type: 'hello',
            protocol: realtimeProtocolVersion,
            ticket: this.ticket.ticket,
          }),
        )
    }
    socket.onmessage = (event) => this.onMessage(event.data)
    socket.onerror = () => {
      // onclose follows; the close handler drives reconnect.
    }
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = undefined
      this.stopTimers()
      if (
        this.closed ||
        this.selfInitiatedClose ||
        this.state.status === 'revoked'
      )
        return
      // A revoked grant will not succeed on retry. An invalid ticket might:
      // it also covers an expired or clock-skewed ticket, so drop the cached
      // one and retry once before giving up.
      if (event.code === invalidTicketCloseCode) {
        this.ticket = undefined
        if (this.ticketRetryUsed) {
          this.stopRetrying()
          return
        }
        this.ticketRetryUsed = true
        this.handleConnectionFailure()
        return
      }
      if (event.code !== undefined && permanentCloseCodes.has(event.code)) {
        this.ticket = undefined
        this.stopRetrying()
        return
      }
      this.handleConnectionFailure()
    }
  }

  private handleConnectionFailure() {
    if (this.closed) return
    this.setState({
      status: 'disconnected',
      capabilities: this.state.capabilities,
      peers: 0,
      collaborators: [],
    })
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, realtimePolicy.reconnectMaxMs)
    this.clearReconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.open()
    }, delay)
  }

  /**
   * Ends the reconnect loop after a refusal retrying cannot fix. The editor
   * keeps working through Drive; a later `connect()` (e.g. the user toggling
   * collaboration back on) starts a fresh attempt.
   */
  private stopRetrying() {
    this.clearReconnect()
    this.backoff = realtimePolicy.reconnectBaseMs
    this.setState({
      status: 'disconnected',
      capabilities: this.state.capabilities,
      peers: 0,
      collaborators: [],
    })
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private onMessage(data: unknown) {
    if (typeof data === 'string') {
      this.onControlMessage(data)
      return
    }
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : undefined
    if (!bytes || bytes.byteLength === 0) return
    const messageType = bytes[0]
    if (messageType <= 2) {
      // y-protocols sync message; reply (e.g. sync step 2) goes back over the socket.
      if (!this.doc) return
      const encoder = encoding.createEncoder()
      readSyncMessage(decoding.createDecoder(bytes), encoder, this.doc, this)
      if (encoding.length(encoder) > 0)
        this.sendBinary(encoding.toUint8Array(encoder))
      return
    }
    if (messageType === messageAwareness) {
      const decoder = decoding.createDecoder(bytes)
      decoding.readVarUint(decoder) // message type
      applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this,
      )
    }
  }

  private onControlMessage(data: string) {
    const message = parseServerControlMessage(data)
    if (!message) return
    if (message.type === 'admitted') {
      this.backoff = realtimePolicy.reconnectBaseMs
      this.setState({
        status: 'connected',
        capabilities: message.capabilities,
        peers: 0,
        collaborators: [],
      })
      if (this.doc) {
        this.startTimers()
        const encoder = encoding.createEncoder()
        writeSyncStep1(encoder, this.doc)
        this.sendBinary(encoding.toUint8Array(encoder))
      }
      // Presence-only state until the editor binds cursors/selections; a null
      // state would encode as a removal and broadcast no presence at all.
      if (this.awareness.getLocalState() === null)
        this.awareness.setLocalState({ presence: true })
      this.awarenessDirty.add(this.awareness.clientID)
      this.sendAwareness()
      this.updatePeers()
      return
    }
    if (message.type === 'revoked') {
      this.stopTimers()
      this.pendingUpdates = []
      this.setState({
        status: 'revoked',
        capabilities: message.capabilities,
        peers: 0,
        collaborators: [],
      })
      return
    }
    console.error('[realtime] server error:', message.message)
    this.listeners.forEach((listener) => listener())
  }

  private startTimers() {
    if (this.updateTimer || this.awarenessTimer) return
    this.updateTimer = setInterval(
      this.flushUpdates,
      realtimePolicy.updateIntervalMs,
    )
    this.awarenessTimer = setInterval(
      this.sendAwareness,
      realtimePolicy.awarenessIntervalMs,
    )
  }

  private stopTimers() {
    if (this.updateTimer) clearInterval(this.updateTimer)
    if (this.awarenessTimer) clearInterval(this.awarenessTimer)
    this.updateTimer = undefined
    this.awarenessTimer = undefined
  }

  private flushUpdates = () => {
    if (this.pendingUpdates.length === 0) return
    if (this.state.status !== 'connected') return
    if (this.state.capabilities?.edit === false) {
      // View-only clients never send updates; drop the buffer.
      this.pendingUpdates = []
      return
    }
    const update = mergeUpdates(this.pendingUpdates)
    this.pendingUpdates = []
    const encoder = encoding.createEncoder()
    writeUpdate(encoder, update)
    this.sendBinary(encoding.toUint8Array(encoder))
  }

  private sendAwareness = () => {
    if (this.state.status !== 'connected' || this.awarenessDirty.size === 0)
      return
    const clients = [...this.awarenessDirty]
    this.awarenessDirty.clear()
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, clients),
    )
    this.sendBinary(encoding.toUint8Array(encoder))
  }

  private sendBinary(data: Uint8Array) {
    this.socket?.send(data)
  }
}
