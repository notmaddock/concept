# Realtime collaboration layer

Status: implemented. The Durable Object lives in `src/worker/realtime-do.ts`, the
room and client transport in `src/lib/documents/realtime/`, and the HTTP
endpoints in `src/routes/api/realtime/$.ts`. The sections below are kept as the
design record; see [As built](#as-built) for where the implementation diverges
from the original plan.

## Core axiom

The realtime layer is an optional accelerator. Google Drive remains the only
durable store and the only commit path: every persisted write is a Drive v2
conditional multipart `PUT` with `If-Match: <etag>` issued with the writer's
own token (`src/lib/documents/drive/api.ts`), and conflicts are resolved by the
existing 412 → download → Yjs merge loop in `src/lib/documents/sync.ts`. If the
WebSocket is unavailable, dead, or disabled, opening, editing, saving, merging
external changes, recovering assets, and working offline must behave exactly as
they do today. The realtime layer never writes to Drive and never acknowledges
revisions.

## Scope

- Drive documents only (`DocumentInfo.drive`, id `G<fileId>`). Local-library
  documents have no `fileId` and no ACL and stay single-player.
- Payload is the Yjs document (sync protocol updates) plus awareness
  (presence, cursors, selections). Asset bytes never travel over the socket;
  they remain on the Drive channel (see Assets).
- The client integration goes through a provider-agnostic `RealtimeProvider`
  interface next to `LocalProvider` and `PublicationTransport`
  (`src/lib/documents/`), keyed by a storage-agnostic handle
  (`{ storage: 'google-drive', fileId }` today) so another backend can slot in
  later without touching `DocumentSync`.

## Design principles

- **Simple code.** Small composable modules that mirror existing patterns —
  `publication.ts` is the template for the client transport — and no
  abstraction beyond the `RealtimeProvider` interface until a second provider
  exists.
- **Minimize roundtrips.** Fewer calls to Google Drive and to our own API
  surface means lower latency; see below.
- **Customizable.** Every interval and budget is a named constant in one policy
  module (same pattern as `src/lib/documents/limits.ts`).

## Tunables

| Constant                     | Default                | Purpose                                                               |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `revalidationIntervalMs`     | 60_000                 | How often the DO re-checks capabilities while the room is active      |
| `idleRevalidationIntervalMs` | 900_000                | Revalidation cadence once the room has been quiet for `idleAfterMs`   |
| `idleAfterMs`                | 300_000                | Quiet period after the last join/save before revalidation backs off   |
| `verdictCacheTtlMs`          | 30_000                 | Cache TTL for per-`(userId, fileId)` capability verdicts              |
| `ticketTtlMs`                | 300_000                | Lifetime of a join ticket                                             |
| `updateIntervalMs`           | 150                    | How often pending Yjs updates are batched and sent over the WebSocket |
| `awarenessIntervalMs`        | 500                    | How often awareness (presence/cursor) state is sent                   |
| `bufferedUpdates`            | 128                    | Relayed updates the DO buffers for late joiners (cache only)          |
| `reconnectBaseMs`            | 1_000                  | First client reconnect backoff delay                                  |
| `reconnectMaxMs`             | 30_000                 | Ceiling for the client's exponential reconnect backoff                |
| `ticketEndpoint`             | `/api/realtime/ticket` | Ticket issuance path                                                  |
| `socketEndpoint`             | `/api/realtime/socket` | WebSocket handoff path to the Durable Object                          |

All values live in `src/lib/documents/realtime/policy.ts`.

## Minimizing roundtrips

- One Drive call per admission: the ticket endpoint is the only place that calls
  Drive at join time; the DO verifies tickets locally and never calls Drive per
  connection. Clients reuse a ticket across reconnects until it expires.
- Revalidation is batched and staggered: one pass per `revalidationIntervalMs`
  over all connected clients, one `files.get` per user, verdicts cached per
  `(userId, fileId)` for `verdictCacheTtlMs`. Access tokens come from the
  existing better-auth token flow and are reused until expiry (refreshed only on
  expiry/401), not minted per check.
- Reuse work the client already does: `DocumentSync.sync(true)` already calls
  `getFileMetadata`, which returns `capabilities`. The client forwards that
  fresh capability snapshot to the DO as a `capabilities` message, so
  activity-triggered revalidation usually needs no extra Drive call. The DO
  still revalidates on its own timer; client-provided snapshots only accelerate
  it, never replace the server-side check.
- Outgoing Yjs updates are batched at `updateIntervalMs` instead of sent per
  keystroke, awareness at `awarenessIntervalMs`; incoming messages are applied
  immediately.
- No polling of our own APIs: the ticket endpoint is called once per session
  (again only on expiry), never in a loop.

## Architecture

One Cloudflare Durable Object per Drive `fileId`, using hibernated WebSockets:

- `wrangler.jsonc` gains a `durable_objects` binding and a new exported DO class
  (wired through the TanStack Start `server-entry`, plus a migration tag). No D1
  migration is required; D1 keeps only better-auth tables.
- The DO routes y-protocols messages (sync step 1/2, update, awareness) between
  connected clients and may buffer recent updates so a late joiner can catch
  up before falling back to Drive. The DO treats its buffer as a cache, not a
  source of truth: on cold start with no state, clients simply sync from their
  local doc and the Drive ETag loop reconciles as usual. Clients send updates
  batched at `updateIntervalMs`; the DO relays immediately.
- The DO does not understand document content and must not be trusted to
  enforce anything by itself; all enforcement decisions come from Drive.

## Hibernation and duration cost

Durable Objects bill duration for as long as they are running, or idle in
memory but _ineligible_ to hibernate. A pending `setTimeout`/`setInterval`, an
unfinished `waitUntil` promise, an open outbound request, or the standard
(non-hibernation) WebSocket API all keep an object resident and billable
around the clock — even with nobody connected. An early version armed a
`setInterval` for revalidation and cost ~117 GB-s per 15 minutes continuously.

Rules this design must keep:

- **No timers in the DO.** Revalidation runs on `storage.setAlarm`, armed only
  while clients are attached and cleared when the last socket closes, so an
  empty room is free and a busy room wakes briefly once per
  `revalidationIntervalMs` instead of staying resident.
- **No in-memory state that must outlive a wake-up.** Hibernation discards it.
  Per-socket identity and capabilities live in the WebSocket attachment
  (`serializeAttachment`); the room is rebuilt per event from those.
- **Message rate is a cost driver.** Every inbound frame wakes the object and
  starts a billable window, so batching matters: awareness is sent on an
  interval rather than per cursor move, and updates are batched at
  `updateIntervalMs`.
- **A wake is cheap; a timer is not.** Billing is duration while executing,
  so an alarm that wakes, makes one Drive call, and sleeps costs a fraction of
  a second. The expensive state is being resident, not being woken. Revalidate
  on activity (join, save) and back off to `idleRevalidationIntervalMs` when
  nothing has happened, so an open tab does not cost a Drive call per minute.
- `src/worker/realtime-do.test.ts` guards these invariants; keep them passing.

## Capabilities model

Admission and relay rights derive from Drive's per-user `capabilities` on the
file, mapped to an adaptive object:

```ts
interface DocumentCapabilities {
  view: boolean // file is readable by this user
  edit: boolean // canEdit && canModifyContent
  comment: boolean // canComment
}
```

- `view` is required to join the socket at all.
- `edit` is required to send Yjs update messages. **The DO enforces this
  server-side**: a `view`-only (or comment-only) client's update messages are
  dropped and answered with an error, not merely ignored client-side. Awareness
  is allowed for all admitted users.
- `DocumentSync.isReadOnly` semantics stay as they are; realtime rights mirror
  them but never widen them.

## Admission (checking access before letting a user in)

1. Client calls `POST /api/realtime/ticket` with the document handle.
2. The Worker verifies the better-auth session cookie (`createAuth(...).api.getSession`,
   same pattern as `src/lib/documents/drive/token.server.ts`), loads the user's
   Google account, mints an access token, and calls Drive `files.get` on the
   `fileId` with `supportsAllDrives=true`.
   - 404/403 from Drive → no ticket (no access).
   - File found → read `capabilities` into `DocumentCapabilities`.
3. The Worker issues a short-lived (`ticketTtlMs`) HMAC-signed ticket bound to
   `(userId, fileId, capabilities, exp)` and returns it.
4. The client opens the WebSocket to `GET /api/realtime/socket`, which hands the
   request to the Durable Object for that `fileId`. The ticket travels both as a
   query parameter and in a `hello` control message; the DO verifies the
   signature and expiry, admits the socket, and records the capabilities. The DO
   does not call Drive per connection.

Drive's ACL stays the single authoritative source of truth; no Concept-owned
members table is introduced.

## Revocation (kicking users who lost access mid-edit)

Enforcement is server-side in the DO, not cooperative:

- The DO revalidates each connected client by calling Drive `files.get` with
  that user's token (fetched via the same auth mechanism as above) and comparing
  capabilities. The interval is `revalidationIntervalMs` (initially 60 seconds,
  see Tunables); verdicts are cached per `(userId, fileId)` for
  `verdictCacheTtlMs` so revalidation does not hammer Drive.
- Revalidation also triggers on: socket (re)connect, and whenever the DO sees a
  Drive publication hint for the file (someone saved — permissions may have
  changed; the existing BroadcastChannel hints in `publication.ts` are the
  in-tab trigger for the same check).
- On any lost capability the DO sends a `revoked` message with the remaining
  capabilities. Loss of `view` closes the socket; loss of `edit` (but not
  `view`) downgrades the client — it stays connected for awareness but has
  update messages dropped (see Capabilities model).
- Client-side, `revoked` is UX, not enforcement: transition through the existing
  read-only path in `DocumentSync` (which already detects `permissionsChanged`
  on `sync(true)`), stop pushing, and surface a toast. The revoked user's next
  `If-Match` write fails with 403/412 and can never persist anything regardless
  of socket state.
- Why polling: `files.watch` push channels accept the `drive.file` scope, but
  they need per-user/per-file channel lifecycle management against a public
  webhook, are not documented to fire on ACL-only changes, and Drive's own
  permission propagation is not instant anyway. Revalidation every
  `revalidationIntervalMs` plus the activity-triggered checks above is the
  honest revocation SLA; `files.watch` remains an optional v2 accelerator.

## Kill switches

- **User-level:** a persisted "Live collaboration" preference, surfaced in the
  permissions indicator (see below). When off, `DocumentSync` never opens the
  realtime provider; behavior is identical to today (Drive ETag sync +
  BroadcastChannel hints). Global, not per-document.
- **Deployment-level:** a `REALTIME_ENABLED` env var on the Worker. When false,
  the ticket endpoint refuses issuance and no socket can be opened at all.

## Permissions indicator (UI)

A small header/status component shows the current user's access and live
collaboration state, backed by the `DocumentCapabilities` object plus the
realtime provider's connection state:

- **One icon for the highest granted permission** — a pencil when edit is
  granted, an eye when only view is available — rather than separate view and
  edit icons. The popover lists each capability on its own line with a green
  (granted) or gray (denied) indicator, including the reserved comment
  permission when capabilities are known.
- **Connected collaborators** are listed with their name, a cursor-color
  swatch, optional avatar from awareness, and a live Editing/Viewing state.
  Available low-cost stats (online count, editing count, connection status) are
  shown without adding new instrumentation. Editing collaborators are
  actionable: selecting one scrolls the document to their caret.
- **The trigger expands into a pill** the same way the sync status does
  (animated label, container-query gated): "View only" when the user cannot
  edit, or "N collaborators" when other people are online. The collaborator
  count excludes the local user and switches between singular and plural.
- The **user-facing kill switch** (the "Live collaboration" preference) is a
  switch in this indicator's menu and applies immediately: turning it off
  disconnects the realtime transport, turning it on creates and connects it.
- When collaboration is off (user preference or `REALTIME_ENABLED=false`), the
  trigger stays compact: the permission icon gets an amber status dot and the
  menu shows a "Live collaboration off" notice explaining that changes sync
  through Drive and reconcile automatically. The old expanding yellow pill
  overlapped the document title, so the off state is never rendered as inline
  text in the header.
- The component reads existing reactive state (`SaveStatus`, capabilities,
  provider connection) via `useSyncExternalStore`, the same pattern as
  `subscribeSaveStatus` in `sync.ts`. No new global store.

## Assets

Yjs updates may reference asset ids whose bytes the receiver does not have.
The realtime layer carries the reference only; the existing
`IncompleteAssetsError` / `missing-assets` machinery in `sync.ts` detects the
gap and triggers the normal Drive `sync(true)` download, with the existing
"retrieving" UI. No new warning protocol is added.

## Failure behavior

- Socket dead, ticket endpoint down, DO unavailable, or either kill switch on:
  the client silently runs the current Drive-only flow. Save status phases,
  retry policy, and offline handling in `DocumentSync` are unchanged.
- A realtime-synced edit is acknowledged only when the Drive `If-Match` write
  succeeds; the DO never marks revisions acknowledged.

## Security invariants

1. Persistence requires a successful conditional Drive write with the writer's
   own token. Realtime can neither commit nor veto a commit.
2. The DO drops update messages from clients without `edit`.
3. Admission and revocation decisions come from Drive capability checks with
   the affected user's own token; tickets are short-lived and bound to
   `(userId, fileId, capabilities)`.
4. The ticket endpoint checks Origin like `/api/drive/token` does.
5. Awareness/update traffic is visible only to admitted (`view`) users; loss of
   `view` closes the socket, loss of `edit` downgrades the client to
   awareness-only.

## Integration notes

- Export the DO class through the worker entry. `wrangler.jsonc` now sets
  `main` to `./worker.ts`, which re-exports the TanStack Start server entry and
  `DocumentRealtimeDO`, and declares the `durable_objects` binding plus the `v1`
  migration tag (preview and production).
- New client modules live under `src/lib/documents/realtime/` (`realtime.ts` for
  the provider interface, `websocket-provider.ts` for the client transport,
  `ticket.ts`, `protocol.ts`, `policy.ts`, `room.ts`) and a server route under
  `src/routes/api/realtime/`; they are lazily loaded so disabling realtime adds
  no cost to the Drive-only path.
- Tests: ticket issuance/refusal, capability mapping, DO admission and
  view-only update dropping, revocation on capability loss, and the
  realtime-disabled fallback (existing `sync.test.ts` coverage must pass
  unchanged with realtime off).

## As built

Where the implementation diverges from or extends the plan above:

### Wire protocol

`src/lib/documents/realtime/protocol.ts` defines protocol version 1. Binary
frames carry raw y-protocols messages (first byte 0–3: sync step 1, sync step 2,
update, awareness). Text frames carry JSON control messages:

| Direction       | Message        | Meaning                                                |
| --------------- | -------------- | ------------------------------------------------------ |
| client → server | `hello`        | Protocol version and ticket                            |
| client → server | `capabilities` | Fresh Drive capability snapshot from the client        |
| client → server | `publication`  | A save landed; revalidate and treat the room as active |
| server → client | `admitted`     | Ticket accepted, with the granted capabilities         |
| server → client | `revoked`      | Capabilities changed; the socket may stay open         |
| server → client | `error`        | Admission or permission failure                        |

Close codes: `4401` means an invalid or expired ticket, `4403` means access was
revoked. The client retries once on `4401` with a fresh ticket and never
reconnects on `4403`.

### Differences from the plan

- **The room is rebuilt on every event.** `DocumentRealtimeDO.roomFromSockets`
  constructs a fresh `DocumentRoom` from the socket attachments for each frame
  and each alarm. The Yjs buffer, awareness buffer, and verdict cache therefore
  never survive a wake-up — stricter than the design's "nothing that must
  outlive a wake-up" rule.
- **Frames that arrive before the attachment are buffered.** A client can send
  its opening sync step between `acceptWebSocket` and the attachment write; the
  DO holds those frames and replays them once the attachment lands.
- **The DO makes one Drive call per cold join.** `admit()` revalidates the
  joining user, so the first join into an empty room is not free of Drive
  calls, though later joins hit the verdict cache.
- **Activity means joins and saves.** `markActive()` runs on admission and on a
  `publication` message, not on ordinary Yjs edits.
- **Losing `comment` revokes like losing `edit`.** The socket stays open and the
  client is told its new capabilities.
- **The BroadcastChannel publication transport is not forwarded to the DO.**
  The socket `publication` message is the only hint the DO receives.
- **`disabled` is a client-side status.** `DocumentSync` synthesizes it from a
  disconnected provider plus the user preference; the server sends no disabled
  message.
- **`REALTIME_ENABLED` is not in `wrangler.jsonc`.** It is typed in
  `src/cloudflare-workers.d.ts` and read as a string; only the exact value
  `'false'` disables ticket issuance.

### Test coverage

`src/worker/realtime-do.test.ts` guards the hibernation invariants (no timers,
alarm only while sockets are attached, cadence backoff, relay after wake-up,
capability persistence). The `src/lib/documents/realtime/*.test.ts` files cover
tickets, capabilities, the Drive verifier, the room, the WebSocket provider, and
the awareness bridge. `DocumentAccessStatus.test.tsx` covers the permissions
indicator. The HTTP adapter in `ticket.server.ts` and the `/api/realtime/socket`
route are not covered directly.
