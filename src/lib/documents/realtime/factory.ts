import type { RealtimeHandle, RealtimeProvider } from './realtime'

/**
 * Creates the realtime provider for a Drive document. The implementation is
 * loaded lazily and the transport stays disconnected until `DocumentSync`
 * applies the user's live-collaboration preference.
 */
export async function createRealtimeProvider(
  handle: RealtimeHandle,
): Promise<RealtimeProvider | undefined> {
  const { storage } = handle as { storage: string }
  if (storage !== 'google-drive') return undefined
  const { WebSocketRealtimeProvider } = await import('./websocket-provider')
  return new WebSocketRealtimeProvider(handle)
}
