/*
 * Single source for the embed hosts that the paste sanitizer may map to a
 * decorator node (P2.6/P2.7) and that the worker CSP allows in `frame-src`.
 * Adding a host here keeps both sides in sync.
 */
export const embedFrameHosts = [
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'www.figma.com',
  'platform.twitter.com',
] as const

const knownHosts: ReadonlySet<string> = new Set(embedFrameHosts)

export function isEmbedFrameHost(hostname: string) {
  return knownHosts.has(hostname)
}
