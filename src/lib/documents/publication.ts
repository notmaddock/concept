export interface PublicationHint {
  protocol: 1
  storage: 'google-drive'
  fileId: string
  validator: string
  revision: string
}

export interface PublicationTransport {
  publish: (hint: PublicationHint) => void
  subscribe: (listener: (hint: PublicationHint) => void) => () => void
  close: () => void
}

export const publicationPolicy = { minimumCheckMs: 5000, rememberedTokens: 128 }

export function isPublicationHint(
  value: unknown,
  fileId: string,
): value is PublicationHint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hint = value as Partial<PublicationHint>
  return (
    hint.protocol === 1 &&
    hint.storage === 'google-drive' &&
    hint.fileId === fileId &&
    typeof hint.validator === 'string' &&
    hint.validator.length > 0 &&
    hint.validator.length <= 1024 &&
    typeof hint.revision === 'string' &&
    /^[a-f0-9]{64}$/.test(hint.revision)
  )
}

export function openPublicationTransport(
  fileId: string,
): PublicationTransport | undefined {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(`concept-publication:${fileId}`)
  const listeners = new Set<(hint: PublicationHint) => void>()
  const seen = new Set<string>()
  let closed = false
  const receipt = (hint: PublicationHint): PublicationHint => ({
    protocol: 1,
    storage: 'google-drive',
    fileId,
    validator: hint.validator,
    revision: hint.revision,
  })
  let lastCheck = -Infinity
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (closed || !isPublicationHint(data, fileId)) return
    if (seen.has(data.validator)) return
    const now = Date.now()
    // A hint suppressed by the rate limit is not recorded, so a later
    // broadcast still delivers it once the window expires.
    if (now - lastCheck < publicationPolicy.minimumCheckMs) return
    seen.add(data.validator)
    if (seen.size > publicationPolicy.rememberedTokens)
      seen.delete(seen.values().next().value!)
    lastCheck = now
    listeners.forEach((listener) => listener(receipt(data)))
  }
  return {
    publish(hint) {
      if (!closed && isPublicationHint(hint, fileId))
        channel.postMessage(receipt(hint))
    },
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      channel.onmessage = null
      channel.close()
    },
  }
}
