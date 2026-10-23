export type DocumentChannelMessage =
  | { type: 'request'; vector: Uint8Array }
  | { type: 'response'; vector: Uint8Array; update: Uint8Array }
  | { type: 'update' | 'awareness'; update: Uint8Array }

export function documentChannelName(id: string) {
  return `concept-document-sync:${id}`
}
