export const remoteDocumentOrigin = { type: 'remote-document-sync' }

export type DocumentChannelMessage =
  | { type: 'request'; vector: Uint8Array; clientId?: string }
  | {
      type: 'response'
      vector: Uint8Array
      update: Uint8Array
      clientId?: string
      targetId?: string
    }
  | {
      type: 'update' | 'awareness'
      update: Uint8Array
      clientId?: string
      synced?: boolean
    }

export function documentChannelName(id: string) {
  return `concept-document-sync:${id}`
}
