import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

type AwarenessState = Record<string, unknown>

// A private origin prevents copied remote states from being mistaken for
// editor-local changes and echoed back into the realtime provider.
const bridgeOrigin = Symbol('awareness-bridge')

function stateRecord(value: unknown): AwarenessState | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AwarenessState)
    : null
}

function stateKey(state: AwarenessState | null): string | undefined {
  try {
    return JSON.stringify(state)
  } catch {
    return undefined
  }
}

/**
 * Connects Lexical's awareness instance to the realtime provider's awareness.
 * Lexical reads and writes cursors through the editor awareness; the provider
 * only knows about the realtime instance, so local selection state is mirrored
 * out and remote peer state is copied in.
 */
export function bridgeAwareness(
  editorAwareness: Awareness,
  realtimeAwareness: Awareness,
): () => void {
  let stopped = false
  let mirroring = false

  const mirrorLocalState = () => {
    if (stopped || mirroring) return
    const editorState = stateRecord(editorAwareness.getLocalState())
    const realtimeState = stateRecord(realtimeAwareness.getLocalState())
    const nextState = editorState
      ? { ...(realtimeState ?? {}), ...editorState }
      : null
    const nextKey = stateKey(nextState)
    const currentKey = stateKey(realtimeState)
    if (nextKey !== undefined && nextKey === currentKey) return
    // Recorded before notifying: setLocalState emits synchronously, and the
    // event handler must not mirror the same state again.
    mirroring = true
    try {
      realtimeAwareness.setLocalState(nextState)
    } finally {
      mirroring = false
    }
  }

  const copyRemoteStates = (clientIDs: Iterable<number>) => {
    if (stopped) return
    const clients = [...new Set(clientIDs)].filter(
      (clientID) =>
        clientID !== realtimeAwareness.clientID &&
        clientID !== editorAwareness.clientID &&
        realtimeAwareness.meta.has(clientID),
    )
    if (clients.length === 0) return

    const states = new Map<number, AwarenessState>()
    for (const clientID of clients) {
      const state = stateRecord(realtimeAwareness.getStates().get(clientID))
      if (state) states.set(clientID, { ...state })
    }

    // Removed clients are absent from `states`; encoding them with their last
    // clock carries the removal into the editor awareness.
    applyAwarenessUpdate(
      editorAwareness,
      encodeAwarenessUpdate(realtimeAwareness, clients, states),
      bridgeOrigin,
    )
  }

  const onEditorUpdate = (_change: AwarenessChange, origin: unknown) => {
    if (origin !== bridgeOrigin) mirrorLocalState()
  }

  const onRealtimeUpdate = (change: AwarenessChange, origin: unknown) => {
    if (origin === bridgeOrigin) return
    // The provider can replace its own local state (for example when admission
    // adds presence), so merge Lexical's fields back in before copying peers.
    mirrorLocalState()
    copyRemoteStates([...change.added, ...change.updated, ...change.removed])
  }

  editorAwareness.on('update', onEditorUpdate)
  realtimeAwareness.on('update', onRealtimeUpdate)
  mirrorLocalState()
  copyRemoteStates(realtimeAwareness.getStates().keys())

  return () => {
    stopped = true
    editorAwareness.off('update', onEditorUpdate)
    realtimeAwareness.off('update', onRealtimeUpdate)
    const remoteClients = [...editorAwareness.getStates().keys()].filter(
      (clientID) => clientID !== editorAwareness.clientID,
    )
    if (remoteClients.length > 0) {
      removeAwarenessStates(editorAwareness, remoteClients, bridgeOrigin)
    }
  }
}
