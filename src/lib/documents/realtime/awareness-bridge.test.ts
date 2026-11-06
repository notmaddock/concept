import { afterEach, describe, expect, it } from 'vitest'
import { Doc } from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { bridgeAwareness } from './awareness-bridge'

const activeAwarenesses: Awareness[] = []
const cleanups: Array<() => void> = []

function makeAwareness() {
  const awareness = new Awareness(new Doc())
  activeAwarenesses.push(awareness)
  return awareness
}

function bridge(editor: Awareness, realtime: Awareness) {
  const cleanup = bridgeAwareness(editor, realtime)
  cleanups.push(cleanup)
  return cleanup
}

function publish(source: Awareness, target: Awareness) {
  applyAwarenessUpdate(
    target,
    encodeAwarenessUpdate(source, [source.clientID]),
    'test',
  )
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  while (activeAwarenesses.length > 0) activeAwarenesses.pop()!.destroy()
})

const selection = {
  anchorPos: { type: 'text', tname: null, item: null, assoc: 0 },
  focusPos: { type: 'text', tname: null, item: null, assoc: 0 },
  focusing: true,
  name: 'Ada',
  color: '#ff0066',
  awarenessData: {},
}

describe('bridgeAwareness', () => {
  it('mirrors local selection fields into the realtime local state', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    realtime.setLocalState({ presence: true })
    editor.setLocalState(selection)

    bridge(editor, realtime)

    expect(realtime.getLocalState()).toEqual({ presence: true, ...selection })
    expect(editor.getStates().has(realtime.clientID)).toBe(false)
  })

  it('keeps mirroring updates and provider fields after attach', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    editor.setLocalState(selection)
    bridge(editor, realtime)

    const moved = {
      ...selection,
      focusPos: { type: 'text', tname: null, item: null, assoc: 1 },
      focusing: false,
    }
    editor.setLocalState(moved)
    expect(realtime.getLocalState()).toEqual(moved)

    // Simulate the provider refreshing its own local state after admission.
    realtime.setLocalState({ presence: true })
    expect(realtime.getLocalState()).toEqual({ presence: true, ...moved })
  })

  it('clears the realtime local state when the editor local state is null', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    realtime.setLocalState({ presence: true })
    editor.setLocalState(selection)
    bridge(editor, realtime)

    editor.setLocalState(null)

    expect(realtime.getLocalState()).toBeNull()
  })

  it('copies current and subsequent remote realtime states into the editor', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    const peer = makeAwareness()
    peer.setLocalState(selection)
    publish(peer, realtime)

    bridge(editor, realtime)
    expect(editor.getStates().get(peer.clientID)).toEqual(selection)

    const updated = { ...selection, focusing: false }
    peer.setLocalState(updated)
    publish(peer, realtime)
    expect(editor.getStates().get(peer.clientID)).toEqual(updated)
  })

  it('propagates remote removals into the editor', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    const peer = makeAwareness()
    peer.setLocalState(selection)
    publish(peer, realtime)
    bridge(editor, realtime)

    peer.setLocalState(null)
    publish(peer, realtime)

    expect(editor.getStates().has(peer.clientID)).toBe(false)
  })

  it('stops propagating in both directions after cleanup', () => {
    const editor = makeAwareness()
    const realtime = makeAwareness()
    realtime.setLocalState({ presence: true })
    editor.setLocalState(selection)
    const cleanup = bridge(editor, realtime)

    cleanup()
    editor.setLocalState({ ...selection, name: 'Later' })
    expect(realtime.getLocalState()).toEqual({ presence: true, ...selection })

    const peer = makeAwareness()
    peer.setLocalState(selection)
    publish(peer, realtime)
    expect(editor.getStates().has(peer.clientID)).toBe(false)

    expect(editor.getLocalState()).not.toBeNull()
    expect(realtime.getLocalState()).not.toBeNull()
  })
})
