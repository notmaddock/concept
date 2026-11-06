import { describe, expect, it } from 'vitest'
import { issueRealtimeTicket } from './ticket.server'
import { verifyRealtimeTicket } from './ticket'
import { realtimePolicy } from './policy'
import type { DocumentCapabilities } from './capabilities'

const secret = 'ticket-secret'
const editorCaps: DocumentCapabilities = {
  view: true,
  edit: true,
  comment: false,
}

interface TicketBody {
  ticket: string
  expiresAt: number
  capabilities: DocumentCapabilities
}

const baseDeps = {
  userId: 'user-1',
  accessToken: 'access-token',
  secret,
  now: 1_000_000,
  fetchCapabilities: () => Promise.resolve(editorCaps),
}

describe('issueRealtimeTicket', () => {
  it('issues a signed ticket with the capabilities embedded', async () => {
    const result = await issueRealtimeTicket(
      { storage: 'google-drive', fileId: 'file-1' },
      baseDeps,
    )
    expect(result.status).toBe(200)
    const body = result.body as TicketBody
    expect(body.expiresAt).toBe(1_000_000 + realtimePolicy.ticketTtlMs)
    expect(body.capabilities).toEqual(editorCaps)
    const payload = await verifyRealtimeTicket(body.ticket, secret, 1_000_000)
    expect(payload).toEqual({
      userId: 'user-1',
      fileId: 'file-1',
      capabilities: editorCaps,
      exp: 1_000_000 + realtimePolicy.ticketTtlMs,
    })
  })

  it('refuses when Drive denies access', async () => {
    const result = await issueRealtimeTicket(
      { storage: 'google-drive', fileId: 'file-1' },
      { ...baseDeps, fetchCapabilities: () => Promise.resolve(undefined) },
    )
    expect(result.status).toBe(403)
    expect(result.body).toEqual({ error: 'No access to this document.' })
  })

  it('refuses when realtime is disabled', async () => {
    const result = await issueRealtimeTicket(
      { storage: 'google-drive', fileId: 'file-1' },
      { ...baseDeps, enabled: false },
    )
    expect(result.status).toBe(403)
    expect(result.body).toEqual({
      error: 'Realtime collaboration is disabled.',
    })
  })

  it('rejects an invalid body', async () => {
    const wrongStorage = await issueRealtimeTicket(
      { storage: 'local', fileId: 'file-1' },
      baseDeps,
    )
    expect(wrongStorage.status).toBe(400)
    const emptyFileId = await issueRealtimeTicket(
      { storage: 'google-drive', fileId: '' },
      baseDeps,
    )
    expect(emptyFileId.status).toBe(400)
    const extraKey = await issueRealtimeTicket(
      { storage: 'google-drive', fileId: 'file-1', extra: true } as unknown as {
        storage: string
        fileId: string
      },
      baseDeps,
    )
    expect(extraKey.status).toBe(400)
  })
})
