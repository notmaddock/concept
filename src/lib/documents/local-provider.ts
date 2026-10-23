import { documentChannelName, remoteDocumentOrigin } from './document-channel'
import type { DocumentChannelMessage } from './document-channel'
import { ObservableV2 } from 'lib0/observable'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs'
import type { Doc } from 'yjs'
import type { Provider } from '@lexical/yjs'
import type { DocumentPersistence } from './storage'

export class LocalProvider
  extends ObservableV2<{
    sync: (synced: boolean) => void
    status: (event: { status: string }) => void
    update: (event: unknown) => void
    reload: (doc: Doc) => void
  }>
  implements Provider
{
  awareness: Provider['awareness']
  private localAwareness: Awareness
  private connected = false
  private revision = 0
  private channel?: BroadcastChannel
  private resumeAfterPageHide = false
  private savedAwareness: ReturnType<Awareness['getLocalState']> = null
  private clientId = `${Math.random().toString(36).slice(2)}-${Date.now()}`

  private onPageHide = () => {
    this.resumeAfterPageHide = this.connected
    this.disconnect()
  }

  private onPageShow = () => {
    if (this.resumeAfterPageHide) {
      this.resumeAfterPageHide = false
      this.connect()
    }
  }

  constructor(
    private id: string,
    private doc: Doc,
    private persistence: DocumentPersistence | (() => DocumentPersistence),
    private initialize?: (doc: Doc) => void,
  ) {
    super()
    this.localAwareness = new Awareness(doc)
    this.awareness = this.localAwareness as unknown as Provider['awareness']
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide)
      window.addEventListener('pageshow', this.onPageShow)
    }
  }

  private send(message: DocumentChannelMessage) {
    this.channel?.postMessage(message)
  }

  private onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this && origin !== remoteDocumentOrigin)
      this.send({ type: 'update', update, clientId: this.clientId })
  }

  private onAwarenessUpdate = (
    {
      added,
      updated,
      removed,
    }: { added: Array<number>; updated: Array<number>; removed: Array<number> },
    origin: unknown,
  ) => {
    if (origin !== this)
      this.send({
        type: 'awareness',
        update: encodeAwarenessUpdate(this.localAwareness, [
          ...added,
          ...updated,
          ...removed,
        ]),
        clientId: this.clientId,
      })
  }

  private onMessage = ({ data }: MessageEvent<DocumentChannelMessage>) => {
    if (!this.connected) return
    if (data.clientId && data.clientId === this.clientId) return
    if (data.type === 'request') {
      this.send({
        type: 'response',
        vector: encodeStateVector(this.doc),
        update: encodeStateAsUpdate(this.doc, data.vector),
        targetId: data.clientId,
        clientId: this.clientId,
      })
      this.send({
        type: 'awareness',
        update: encodeAwarenessUpdate(this.localAwareness, [
          ...this.localAwareness.getStates().keys(),
        ]),
        clientId: this.clientId,
      })
    } else if (data.type === 'response') {
      if (data.targetId && data.targetId !== this.clientId) return
      applyUpdate(this.doc, data.update, this)
      const diff = encodeStateAsUpdate(this.doc, data.vector)
      if (diff.byteLength > 2) {
        this.send({
          type: 'update',
          update: diff,
          clientId: this.clientId,
        })
      }
    } else if (data.type === 'update') {
      applyUpdate(
        this.doc,
        data.update,
        data.synced ? remoteDocumentOrigin : this,
      )
    } else {
      applyAwarenessUpdate(this.localAwareness, data.update, this)
    }
  }

  connect() {
    if (this.connected) return
    this.connected = true
    const revision = ++this.revision
    if (typeof this.persistence === 'function')
      this.persistence = this.persistence()
    void this.persistence.whenSynced
      .then(() => {
        if (!this.connected || revision !== this.revision) return
        this.initialize?.(this.doc)
        if (this.savedAwareness && !this.localAwareness.getLocalState())
          this.localAwareness.setLocalState(this.savedAwareness)
        if (typeof BroadcastChannel !== 'undefined') {
          this.channel = new BroadcastChannel(documentChannelName(this.id))
          this.channel.onmessage = this.onMessage
        }
        this.doc.on('update', this.onDocumentUpdate)
        this.localAwareness.on('update', this.onAwarenessUpdate)
        this.send({
          type: 'request',
          vector: encodeStateVector(this.doc),
          clientId: this.clientId,
        })
        this.send({
          type: 'awareness',
          update: encodeAwarenessUpdate(this.localAwareness, [
            this.doc.clientID,
          ]),
          clientId: this.clientId,
        })
        this.emit('status', [{ status: 'connected' }])
        this.emit('sync', [true])
      })
      .catch(() => {
        if (revision === this.revision) this.disconnect()
      })
  }

  disconnect() {
    this.connected = false
    ++this.revision
    this.savedAwareness =
      this.localAwareness.getLocalState() ?? this.savedAwareness
    this.localAwareness.setLocalState(null)
    this.doc.off('update', this.onDocumentUpdate)
    this.localAwareness.off('update', this.onAwarenessUpdate)
    this.channel?.close()
    this.channel = undefined
    this.emit('status', [{ status: 'disconnected' }])
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide)
      window.removeEventListener('pageshow', this.onPageShow)
    }
    this.disconnect()
    this.localAwareness.destroy()
    super.destroy()
  }
}
