# Realtime collaboration layer

Status: design. Not implemented.

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

| Constant                 | Default | Purpose                                                               |
| ------------------------ | ------- | --------------------------------------------------------------------- |
| `revalidationIntervalMs` | 60_000  | How often the DO re-checks each connected client's Drive capabilities |
| `verdictCacheTtlMs`      | 30_000  | Cache TTL for per-`(userId, fileId)` capability verdicts              |
| `ticketTtlMs`            | 300_000 | Lifetime of a join ticket                                             |
| `updateIntervalMs`       | 150     | How often pending Yjs updates are batched and sent over the WebSocket |
| `awarenessIntervalMs`    | 250     | How often awareness (presence/cursor) state is sent                   |

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

1. Client calls an HTTP endpoint (e.g. `POST /api/realtime/ticket`) with the
   document handle.
2. The Worker verifies the better-auth session cookie (`createAuth(...).api.getSession`,
   same pattern as `src/lib/documents/drive/token.server.ts`), loads the user's
   Google account, mints an access token, and calls Drive `files.get` on the
   `fileId` with `supportsAllDrives=true`.
   - 404/403 from Drive → no ticket (no access).
   - File found → read `capabilities` into `DocumentCapabilities`.
3. The Worker issues a short-lived (`ticketTtlMs`) HMAC-signed ticket bound to
   `(userId, fileId, capabilities, exp)` and returns it.
4. The client opens the WebSocket to the DO for that `fileId`, presenting the
   ticket. The DO verifies the signature and expiry, admits the socket, and
   records the capabilities. The DO does not call Drive per connection.

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

- **Separate view and edit indicators** (e.g. distinct icon + color per
  capability), not a single read-only flag. A comment indicator is reserved for
  the later comment-permission extension; the layout must not need rework when
  it lands.
- The **user-facing kill switch** (the "Live collaboration" preference) lives in
  this indicator's menu.
- When collaboration is off (user preference or `REALTIME_ENABLED=false`), the
  view indicator **expands into a yellow pill** ("live collaboration off") —
  but only when there is enough horizontal space in the header; otherwise it
  collapses to the compact icon so the layout never overflows.
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

- Export the DO class through the worker entry (`main` is currently
  `@tanstack/react-start/server-entry`) and add the `durable_objects` binding +
  migration to `wrangler.jsonc` (preview and production).
- New client modules under `src/lib/documents/` (e.g. `realtime.ts` for the
  provider interface, `realtime-ticket.ts` client) and a server route under
  `src/routes/api/realtime/`; keep them lazily loaded so disabling realtime adds
  no cost to the Drive-only path.
- Tests: ticket issuance/refusal, capability mapping, DO admission and
  view-only update dropping, revocation on capability loss, and the
  realtime-disabled fallback (existing `sync.test.ts` coverage must pass
  unchanged with realtime off).
