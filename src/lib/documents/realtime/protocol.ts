import { isDocumentCapabilities } from './capabilities'
import type { DocumentCapabilities } from './capabilities'

export const realtimeProtocolVersion = 1

/**
 * Wire protocol over the WebSocket: binary frames carry raw y-protocols
 * messages (sync step 1/2, update, awareness — first byte 0-3), text frames
 * carry JSON control messages defined here.
 */
export type ClientControlMessage =
  | { type: 'hello'; protocol: number; ticket: string }
  | { type: 'capabilities'; capabilities: DocumentCapabilities }
  | { type: 'publication' }

export type ServerControlMessage =
  | { type: 'admitted'; capabilities: DocumentCapabilities }
  | { type: 'revoked'; capabilities: DocumentCapabilities }
  | { type: 'error'; message: string }

export function encodeControlMessage(message: ClientControlMessage | ServerControlMessage) {
  return JSON.stringify(message)
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

export function parseClientControlMessage(data: string): ClientControlMessage | undefined {
  const value = parseJson(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.type === 'hello') {
    return typeof message.ticket === 'string' &&
      message.ticket.length > 0 &&
      message.ticket.length <= 4096 &&
      message.protocol === realtimeProtocolVersion
      ? { type: 'hello', protocol: realtimeProtocolVersion, ticket: message.ticket }
      : undefined
  }
  if (message.type === 'capabilities')
    return isDocumentCapabilities(message.capabilities)
      ? { type: 'capabilities', capabilities: message.capabilities }
      : undefined
  if (message.type === 'publication') return { type: 'publication' }
  return undefined
}

export function parseServerControlMessage(data: string): ServerControlMessage | undefined {
  const value = parseJson(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.type === 'admitted' || message.type === 'revoked') {
    return isDocumentCapabilities(message.capabilities)
      ? { type: message.type, capabilities: message.capabilities }
      : undefined
  }
  if (message.type === 'error' && typeof message.message === 'string')
    return { type: 'error', message: message.message }
  return undefined
}
