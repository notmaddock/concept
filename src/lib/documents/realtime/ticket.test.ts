import { describe, expect, it } from 'vitest'
import { signRealtimeTicket, verifyRealtimeTicket } from './ticket'

const secret = 'test-secret'
const payload = {
  userId: 'user-1',
  fileId: 'file-1',
  capabilities: { view: true, edit: true, comment: false },
  exp: 1_000_000,
}

describe('realtime ticket', () => {
  it('round-trips a signed ticket', async () => {
    const ticket = await signRealtimeTicket(payload, secret)
    await expect(verifyRealtimeTicket(ticket, secret, 999_999)).resolves.toEqual(payload)
  })

  it('rejects an expired ticket', async () => {
    const ticket = await signRealtimeTicket(payload, secret)
    await expect(verifyRealtimeTicket(ticket, secret, 1_000_000)).resolves.toBeUndefined()
    await expect(verifyRealtimeTicket(ticket, secret, 2_000_000)).resolves.toBeUndefined()
  })

  it('rejects a ticket signed with another secret', async () => {
    const ticket = await signRealtimeTicket(payload, 'other-secret')
    await expect(verifyRealtimeTicket(ticket, secret, 999_999)).resolves.toBeUndefined()
  })

  it('rejects a tampered payload', async () => {
    const ticket = await signRealtimeTicket(payload, secret)
    const [version, body, signature] = ticket.split('.')
    const forged = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    forged.capabilities = { view: true, edit: true, comment: true }
    const forgedBody = btoa(JSON.stringify(forged))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    await expect(
      verifyRealtimeTicket(`${version}.${forgedBody}.${signature}`, secret, 999_999),
    ).resolves.toBeUndefined()
  })

  it('rejects malformed tickets', async () => {
    await expect(verifyRealtimeTicket('', secret)).resolves.toBeUndefined()
    await expect(verifyRealtimeTicket('v1.onlytwo', secret)).resolves.toBeUndefined()
    await expect(verifyRealtimeTicket('v2.a.b', secret)).resolves.toBeUndefined()
    await expect(verifyRealtimeTicket('v1.!!!.!!!', secret)).resolves.toBeUndefined()
    const ticket = await signRealtimeTicket(
      { ...payload, capabilities: { view: 'yes' } as never },
      secret,
    )
    await expect(verifyRealtimeTicket(ticket, secret, 1)).resolves.toBeUndefined()
  })
})
