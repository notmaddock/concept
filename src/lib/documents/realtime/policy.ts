/**
 * Every realtime interval and budget lives here, mirroring `../limits.ts`.
 * The five tunables from the design doc are the first five entries.
 */
export const realtimePolicy = {
  /**
   * How often the DO re-checks each connected client's Drive capabilities
   * while the room is active (someone saved, joined, or edited recently).
   * Scheduled with `storage.setAlarm`, never `setInterval`: a pending timer
   * keeps the object in memory and bills duration around the clock.
   */
  revalidationIntervalMs: 60_000,
  /**
   * Revalidation cadence once a room has been quiet for `idleAfterMs`. Drive
   * ACL changes reach us through saves (the publication hint), so a silent
   * room does not need a Drive call every minute; this bounds the cost of a
   * tab left open without weakening the save-triggered check.
   */
  idleRevalidationIntervalMs: 900_000,
  /** Quiet period after the last save/join before backing off revalidation. */
  idleAfterMs: 300_000,
  /** Cache TTL for per-(userId, fileId) capability verdicts. */
  verdictCacheTtlMs: 30_000,
  /** Lifetime of a join ticket. */
  ticketTtlMs: 300_000,
  /** How often pending Yjs updates are batched and sent over the WebSocket. */
  updateIntervalMs: 150,
  /** How often awareness (presence/cursor) state is sent. */
  awarenessIntervalMs: 500,
  /** How many relayed updates the DO buffers for late joiners (cache only). */
  bufferedUpdates: 128,
  /** Exponential reconnect backoff for the client socket. */
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  ticketEndpoint: '/api/realtime/ticket',
  socketEndpoint: '/api/realtime/socket',
} as const

export type RealtimePolicy = typeof realtimePolicy
