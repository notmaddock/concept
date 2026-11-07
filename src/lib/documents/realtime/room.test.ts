import { describe, expect, it, vi } from 'vitest'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
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
    return typeof last === 'string'
      ? parseServerControlMessage(last)
      : undefined
  }
}

function makeVerifier(
  verdicts: Record<string, DocumentCapabilities | undefined>,
): DriveVerifier & { calls: Array<{ fileId: string; userId: string }> } {
  const calls: Array<{ fileId: string; userId: string }> = []
  return {
    calls,
    async verify(checkedFileId, userId) {
      calls.push({ fileId: checkedFileId, userId })
      return verdicts[userId]
    },
  }
}

/** Verifier whose check always fails, as on a Drive outage. */
function makeThrowingVerifier(): DriveVerifier & {
  calls: Array<{ fileId: string; userId: string }>
} {
  const calls: Array<{ fileId: string; userId: string }> = []
  return {
    calls,
    async verify(checkedFileId, userId) {
      calls.push({ fileId: checkedFileId, userId })
      throw new Error('Drive files.get failed with status 500.')
    },
  }
}

const editorCaps: DocumentCapabilities = {
  view: true,
  edit: true,
  comment: false,
}
const viewerCaps: DocumentCapabilities = {
  view: true,
  edit: false,
  comment: false,
}

async function ticketFor(
  userId: string,
  capabilities: DocumentCapabilities,
  exp = 1_000_000,
) {
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
  users: Array<{
    id: string
    userId: string
    capabilities: DocumentCapabilities
  }>,
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
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
    const socket = new FakeSocket('s1')
    await expect(
      room.admit(socket, await ticketFor('user-1', editorCaps)),
    ).resolves.toBe(true)
    expect(room.clientCount()).toBe(1)
    expect(socket.lastControl()).toEqual({
      type: 'admitted',
      capabilities: editorCaps,
    })
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
      {
        userId: 'user-1',
        fileId: 'other-file',
        capabilities: editorCaps,
        exp: 1_000_000,
      },
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
      room.admit(
        socket,
        await ticketFor('user-1', { view: false, edit: false, comment: false }),
      ),
    ).resolves.toBe(false)
  })

  it('never calls Drive per connection', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
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
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [
      awareness.clientID,
    ])
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
    const verifier = makeVerifier({
      a: editorCaps,
      b: editorCaps,
      c: editorCaps,
    })
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

describe('DocumentRoom hibernation restore', () => {
  it('exposes the admitted client so the DO can persist an attachment', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
    await room.admit(
      new FakeSocket('s1'),
      await ticketFor('user-1', editorCaps),
    )
    expect(room.client('s1')).toEqual({
      userId: 'user-1',
      capabilities: editorCaps,
    })
    expect(room.client('missing')).toBeUndefined()
  })

  it('relays and enforces capabilities for a socket restored from an attachment', async () => {
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
    const restored = new FakeSocket('s1')
    room.restore(restored, {
      adapterId: 's1',
      userId: 'user-1',
      capabilities: viewerCaps,
    })
    expect(room.clientCount()).toBe(1)
    // A restored view-only client is still refused server-side.
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    room.receive('s1', updateMessage(encodeStateAsUpdate(source)))
    expect(restored.lastControl()?.type).toBe('error')
  })

  it('ignores a restore whose socket already disconnected', () => {
    const verifier = makeVerifier({})
    const room = new DocumentRoom({ fileId, secret, verifier })
    room.restore(undefined, {
      adapterId: 'gone',
      userId: 'user-1',
      capabilities: editorCaps,
    })
    expect(room.clientCount()).toBe(0)
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
    expect(socket.lastControl()).toEqual({
      type: 'revoked',
      capabilities: viewerCaps,
    })
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
    const now = 500_000
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
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    expect(verifier.calls).toHaveLength(1)
    room.receive(
      's1',
      encodeControlMessage({ type: 'capabilities', capabilities: editorCaps }),
    )
    await vi.waitFor(() => expect(verifier.calls.length).toBe(2))
    room.remove('s1')
  })

  it('replays buffered awareness to a late joiner on sync step 1', async () => {
    const verifier = makeVerifier({ a: editorCaps, c: editorCaps })
    const sockets: FakeSocket[] = []
    const room = await admittedRoom(verifier, sockets, [
      { id: 'a', userId: 'a', capabilities: editorCaps },
    ])
    const awareness = new Awareness(new Doc())
    awareness.setLocalState({ presence: true })
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 3)
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(awareness, [awareness.clientID]),
    )
    room.receive('a', encoding.toUint8Array(encoder))

    const joinerSocket = new FakeSocket('c')
    sockets.push(joinerSocket)
    await room.admit(joinerSocket, await ticketFor('c', editorCaps))
    room.receive('c', syncStep1(new Doc()))
    const replayed = joinerSocket.sent.filter(
      (data) => typeof data !== 'string' && data[0] === 3,
    )
    expect(replayed).toHaveLength(1)
    room.remove('a')
    room.remove('c')
  })

  it('ignores messages from unknown sockets', async () => {
    const verifier = makeVerifier({})
    const room = new DocumentRoom({ fileId, secret, verifier })
    room.receive('ghost', updateMessage(encodeStateAsUpdate(new Doc())))
    room.receive('ghost', encodeControlMessage({ type: 'publication' }))
    expect(verifier.calls).toHaveLength(0)
  })
})

describe('DocumentRoom revalidation resilience', () => {
  it('keeps an editor when the revalidation check throws', async () => {
    let now = 500_000
    const verifier = makeVerifier({ a: editorCaps, b: editorCaps })
    const sockets: FakeSocket[] = []
    const room = await admittedRoom(
      verifier,
      sockets,
      [
        { id: 'a', userId: 'a', capabilities: editorCaps },
        { id: 'b', userId: 'b', capabilities: editorCaps },
      ],
      () => now,
    )
    verifier.verify = vi.fn(async () => {
      throw new Error('Drive files.get failed with status 500.')
    })
    now += 31_000 // move past the verdict cache TTL
    await expect(room.revalidate()).resolves.toBeUndefined()
    const [a, b] = sockets
    expect(a.closed).toBeUndefined()
    expect(b.closed).toBeUndefined()
    expect(
      a.sent.filter(
        (data) => typeof data === 'string' && data.includes('"revoked"'),
      ),
    ).toHaveLength(0)
    expect(room.clientCount()).toBe(2)
    expect(room.client('a')?.capabilities).toEqual(editorCaps)

    // Still in the room: a subsequent relay reaches the other editor.
    const source = new Doc()
    source.getMap('root').set('key', 'value')
    const before = b.sent.filter((data) => typeof data !== 'string').length
    room.receive('a', updateMessage(encodeStateAsUpdate(source)))
    expect(b.sent.filter((data) => typeof data !== 'string')).toHaveLength(
      before + 1,
    )
    room.remove('a')
    room.remove('b')
  })

  it('downgrades an editor when revalidation reports lost edit', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const room = new DocumentRoom({ fileId, secret, verifier, now: () => now })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    verifier.verify = vi.fn(async () => viewerCaps)
    now += 31_000 // move past the verdict cache TTL
    await room.revalidate()
    expect(socket.lastControl()).toEqual({
      type: 'revoked',
      capabilities: viewerCaps,
    })
    expect(socket.closed).toBeUndefined()
    expect(room.clientCount()).toBe(1)
    expect(room.client('s1')?.capabilities).toEqual(viewerCaps)
    room.remove('s1')
  })

  it('does not revoke a user whose first revalidation throws', async () => {
    const verifier = makeThrowingVerifier()
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => 500_000,
    })
    const socket = new FakeSocket('s1')
    await expect(
      room.admit(socket, await ticketFor('user-1', editorCaps)),
    ).resolves.toBe(true)
    expect(verifier.calls).toHaveLength(1)
    expect(socket.closed).toBeUndefined()
    expect(socket.lastControl()).toEqual({
      type: 'admitted',
      capabilities: editorCaps,
    })
    expect(room.clientCount()).toBe(1)
    expect(room.client('s1')?.capabilities).toEqual(editorCaps)
    room.remove('s1')
  })

  it('still revokes and closes with 4403 on a genuine undefined verdict', async () => {
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

  it('reports the downgraded capabilities through onCapabilitiesChanged', async () => {
    let now = 500_000
    const verifier = makeVerifier({ 'user-1': editorCaps })
    const onCapabilitiesChanged = vi.fn()
    const room = new DocumentRoom({
      fileId,
      secret,
      verifier,
      now: () => now,
      onCapabilitiesChanged,
    })
    const socket = new FakeSocket('s1')
    await room.admit(socket, await ticketFor('user-1', editorCaps))
    verifier.verify = vi.fn(async () => viewerCaps)
    now += 31_000 // move past the verdict cache TTL
    await room.revalidate()
    // Fires on admission too, so assert the latest report is the downgrade.
    expect(onCapabilitiesChanged).toHaveBeenLastCalledWith('s1', viewerCaps)
    expect(onCapabilitiesChanged.mock.calls).toEqual([
      ['s1', editorCaps],
      ['s1', viewerCaps],
    ])
    room.remove('s1')
  })
})
