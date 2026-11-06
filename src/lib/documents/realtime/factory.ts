import { isLiveCollaborationEnabled } from './preferences'
import type { RealtimeHandle, RealtimeProvider } from './realtime'

/**
 * Creates the realtime provider for a document, or undefined when realtime
 * does not apply (kill switch off, or not a Drive document). The provider
 * implementation is loaded lazily so the Drive-only path pays no cost when
 * realtime is disabled. All failures resolve to undefined — realtime is an
 * optional accelerator, never a requirement.
 */
export async function createRealtimeProvider(
  handle: RealtimeHandle,
): Promise<RealtimeProvider | undefined> {
  if (!isLiveCollaborationEnabled()) return undefined
  const { storage } = handle as { storage: string }
  if (storage !== 'google-drive') return undefined
  const { WebSocketRealtimeProvider } = await import('./websocket-provider')
  const provider = new WebSocketRealtimeProvider(handle)
  provider.connect()
  return provider
}
