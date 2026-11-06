import { describe, expect, it, vi } from 'vitest'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs'
import { writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { encodeAwarenessUpdate, Awareness } from 'y-protocols/awareness'
import { DocumentRoom } from './room'
import { signRealtimeTicket } from './ticket'
import { encodeControlMessage, parseServerControlMessage } from './protocol'
import type { RoomSocket, DriveVerifier } from './room'
import type { DocumentCapabilities } from './capabilities'

const secret = 'room-secret'
const fileId = 'file-1'

class FakeSocket implements RoomSocket {
  sent: Array<string | Uint8Array> = []
  closed?: { code?: number; reason?: string }
  constructor(readonly id: string) {}
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  lastControl() {
    const last = this.sent[this.sent.length - 1]
    return typeof last === 'string' ? parseServerControlMessage(last) : undefined
  }
}

function makeVerifier(
  verdicts: Record<string, DocumentCapabilities | undefined>,
): DriveVerifier & { calls: Array<{ fileId: string; userId: string }> } {
  const calls: Array<{ fileId: string; userId: string }> = []
  return {
    calls,
    async verify(fileId, userId) {
      calls.push({ fileId, userId })
      return verdicts[userId]
    },
  }
}

const editorCaps: DocumentCapabilities = { view: true, edit: true, comment: false }
const viewerCaps: DocumentCapabilities = { view: true, edit: false, comment: false }

async function ticketFor(userId: string, capabilities: DocumentCapabilities, exp = 1_000_000) {
  return signRealtimeTicket({ userId, fileId, capabilities, exp }, secret)
}

function syncStep1(doc: Doc) {
  const encoder = encoding.createEncoder()
  writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

function updateMessage(update: Uint8Array) {
  const encoder = encoding.createEncoder()
  writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

async function admittedRoom(
  verifier: DriveVerifier,
  sockets: FakeSocket[],
  users: Array<{ id: string; userId: string; capabilities: DocumentCapabilities }>,
  now = () => 500_000,
) {
  const room = new DocumentRoom({ fileId, secret, verifier, now })
  for (const user of users) {
    const socket = new FakeSocket(user.id)
    sockets.push(socket)
    await room.admit(socket, await ticketFor(user.userId, user.capabilities))
  }
  return room
}

describe('DocumentRoom admission', () => {
  it('admits a valid ticket and reports capabilities', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => 500_000 })
    const socket = new FakeSocket('s1')
    await expect(room.admit(socket, await ticketFor('user-1', editorCaps))).resolves.toBe(true)
    expect(room.clientCount()).toBe(1)
    expect(socket.lastControl()).toEqual({ type: 'admitted', capabilities: editorCaps })
  })

  it('rejects an invalid ticket and closes the socket', async () => {
    const verifier = makeVerifier({})
    const room = new DocumentRoom({ fileId, secret, verifier })
    const socket = new FakeSocket('s1')
    await expect(room.admit(socket, 'v1.bad.bad')).resolves.toBe(false)
    expect(room.clientCount()).toBe(0)
    expect(socket.closed?.code).toBe(4401)
  })

  it('rejects a ticket for another file', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier })
    const ticket = await signRealtimeTicket(
      { userId: 'user-1', fileId: 'other-file', capabilities: editorCaps, exp: 1_000_000 },
      secret,
    )
    const socket = new FakeSocket('s1')
    await expect(room.admit(socket, ticket)).resolves.toBe(false)
  })

  it('rejects a view-less ticket', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier })
    const socket = new FakeSocket('s1')
    await expect(
      room.admit(socket, await ticketFor('user-1', { view: false, edit: false, comment: false })),
    ).resolves.toBe(false)
  })

  it('never calls Drive per connection', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => 500_000 })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    expect(verifier.calls).toHaveLength(1) // revalidation on connect, not per message
    room.receive('s1', updateMessage(encodeStateAsUpdate(new Doc())))
    room.receive('s1', syncStep1(new Doc()))
    expect(verifier.calls).toHaveLength(1)
  })
})

describe('DocumentRoom relay', () => {
  it('relays updates and awareness between admitted clients', async () => {
    const verifier = makeVerifier({ a: editorCaps, b: viewerCaps })
    const sockets: FakeSocket[] = []
    const room = await admittedRoom(verifier, sockets, [
      { id: 'a', userId: 'a', capabilities: editorCaps },
      { id: 'b', userId: 'b', capabilities: viewerCaps },
    ])
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    const update = updateMessage(encodeStateAsUpdate(source))
    room.receive('a', update)
    const [a, b] = sockets
    expect(b.sent.some((data) => typeof data !== 'string')).toBe(true)
    expect(a.sent.filter((data) => typeof data !== 'string')).toHaveLength(0)

    const awareness = new Awareness(new Doc())
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 3)
    encoding.writeVarUint8Array(encoder, awarenessUpdate)
    room.receive('b', encoding.toUint8Array(encoder))
    expect(a.sent.some((data) => typeof data !== 'string')).toBe(true)
    room.remove('a')
    room.remove('b')
  })

  it('drops updates from view-only clients and answers with an error', async () => {
    const verifier = makeVerifier({ a: editorCaps, b: viewerCaps })
    const sockets: FakeSocket[] = []
    const room = await admittedRoom(verifier, sockets, [
      { id: 'a', userId: 'a', capabilities: editorCaps },
      { id: 'b', userId: 'b', capabilities: viewerCaps },
    ])
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    room.receive('b', updateMessage(encodeStateAsUpdate(source)))
    const [a, b] = sockets
    expect(a.sent.filter((data) => typeof data !== 'string')).toHaveLength(0)
    expect(b.lastControl()?.type).toBe('error')
    room.remove('a')
    room.remove('b')
  })

  it('serves a late joiner buffered updates on sync step 1', async () => {
    const verifier = makeVerifier({ a: editorCaps, b: editorCaps, c: editorCaps })
    const sockets: FakeSocket[] = []
    const room = await admittedRoom(verifier, sockets, [
      { id: 'a', userId: 'a', capabilities: editorCaps },
      { id: 'b', userId: 'b', capabilities: editorCaps },
    ])
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    room.receive('a', updateMessage(encodeStateAsUpdate(source)))

    const joiner = new Doc()
    const joinerSocket = new FakeSocket('c')
    sockets.push(joinerSocket)
    await room.admit(joinerSocket, await ticketFor('c', editorCaps))
    room.receive('c', syncStep1(joiner))

    const binary = joinerSocket.sent.find((data) => typeof data !== 'string')
    expect(binary).toBeInstanceOf(Uint8Array)
    const target = new Doc()
    applyUpdate(target, encodeStateAsUpdate(joiner))
    const decoder = decoding.createDecoder(binary as Uint8Array)
    expect(decoding.readVarUint(decoder)).toBe(1) // sync step 2
    const update = decoding.readVarUint8Array(decoder)
    applyUpdate(target, update)
    expect(target.getMap('root').get('key')).toBe('value')
    room.remove('a')
    room.remove('b')
    room.remove('c')
  })
})

describe('DocumentRoom revocation', () => {
  it('closes the socket when view is lost', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => now })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    verifier.verify = vi.fn(async () => undefined)
    now += 31_000 // move past the verdict cache TTL
    await room.revalidate()
    expect(socket.lastControl()).toEqual({
      type: 'revoked',
      capabilities: { view: false, edit: false, comment: false },
    })
    expect(socket.closed?.code).toBe(4403)
    expect(room.clientCount()).toBe(0)
  })

  it('downgrades to awareness-only when edit is lost but view remains', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => now })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    verifier.verify = vi.fn(async () => viewerCaps)
    now += 31_000 // move past the verdict cache TTL
    await room.revalidate()
    expect(socket.lastControl()).toEqual({ type: 'revoked', capabilities: viewerCaps })
    expect(socket.closed).toBeUndefined()
    expect(room.clientCount()).toBe(1)
    // Updates are now dropped server-side.
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    room.receive('s1', updateMessage(encodeStateAsUpdate(source)))
    expect(socket.lastControl()?.type).toBe('error')
    room.remove('s1')
  })

  it('caches verdicts per user for verdictCacheTtlMs', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => now })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    expect(verifier.calls).toHaveLength(1)
    await room.revalidate()
    expect(verifier.calls).toHaveLength(1) // cached
    now += 31_000
    await room.revalidate()
    expect(verifier.calls).toHaveLength(2) // TTL expired
    room.remove('s1')
  })

  it('revalidates on a publication hint', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => now })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    expect(verifier.calls).toHaveLength(1)
    room.receive('s1', encodeControlMessage({ type: 'publication' }))
    await vi.waitFor(() => expect(verifier.calls.length).toBeGreaterThan(1))
    room.remove('s1')
  })

  it('client capabilities hints accelerate revalidation without replacing it', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => 500_000 })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    expect(verifier.calls).toHaveLength(1)
    room.receive('s1', encodeControlMessage({ type: 'capabilities', capabilities: editorCaps }))
    await vi.waitFor(() => expect(verifier.calls.length).toBe(2))
    room.remove('s1')
  })

  it('ignores messages from unknown sockets', async () => {
    const verifier = makeVerifier({})
    const room = new DocumentRoom({ fileId, secret, verifier })
    room.receive('ghost', updateMessage(encodeStateAsUpdate(new Doc())))
    room.receive('ghost', encodeControlMessage({ type: 'publication' }))
    expect(verifier.calls).toHaveLength(0)
  })
})
