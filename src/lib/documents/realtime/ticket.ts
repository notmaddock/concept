import { isDocumentCapabilities } from './capabilities'
import type { DocumentCapabilities } from './capabilities'

/**
 * Short-lived HMAC-signed join ticket bound to (userId, fileId, capabilities).
 * Issued by the ticket endpoint, verified locally by the Durable Object, which
 * never calls Drive per connection.
 */
export interface RealtimeTicketPayload {
  jti: string
  userId: string
  fileId: string
  capabilities: DocumentCapabilities
  /** Expiration time in milliseconds since the epoch. */
  exp: number
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function sign(key: CryptoKey, data: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(data),
  )
  return base64UrlEncode(new Uint8Array(signature))
}

function validPayload(value: unknown): value is RealtimeTicketPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.jti === 'string' &&
    payload.jti.length > 0 &&
    payload.jti.length <= 256 &&
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    payload.userId.length <= 256 &&
    typeof payload.fileId === 'string' &&
    payload.fileId.length > 0 &&
    payload.fileId.length <= 256 &&
    isDocumentCapabilities(payload.capabilities) &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp)
  )
}

export type SignRealtimeTicketPayload = Omit<RealtimeTicketPayload, 'jti'> & {
  jti?: string
}

/** Produces a `v1.<payload>.<signature>` ticket string. */
export async function signRealtimeTicket(
  payload: SignRealtimeTicketPayload,
  secret: string,
): Promise<string> {
  const fullPayload: RealtimeTicketPayload = {
    ...payload,
    jti: payload.jti ?? crypto.randomUUID(),
  }
  const body = base64UrlEncode(textEncoder.encode(JSON.stringify(fullPayload)))
  const signature = await sign(await hmacKey(secret), `v1.${body}`)
  return `v1.${body}.${signature}`
}

/**
 * Verifies signature and expiry. Returns undefined for any malformed,
 * tampered, or expired ticket.
 */
export async function verifyRealtimeTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): Promise<RealtimeTicketPayload | undefined> {
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return undefined
  const [, body, signature] = parts
  let payload: unknown
  try {
    payload = JSON.parse(textDecoder.decode(base64UrlDecode(body)))
  } catch {
    return undefined
  }
  if (!validPayload(payload)) return undefined
  const expected = await sign(await hmacKey(secret), `v1.${body}`)
  if (expected.length !== signature.length) return undefined
  const a = textEncoder.encode(expected)
  const b = textEncoder.encode(signature)
  let mismatch = 0
  for (let index = 0; index < a.length; index++) mismatch |= a[index] ^ b[index]
  if (mismatch !== 0) return undefined
  if (payload.exp <= now) return undefined
  return payload
}
