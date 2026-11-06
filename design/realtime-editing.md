# Realtime editing and document access

Status: implementation authorized, 2026-11-06. User decisions are distinguished from operating defaults and validation requirements below.

## Agreed constraints

- Realtime is optional. Opening, local editing, saving, conflict reconciliation, asset recovery, and eventual convergence must work through HTTP and Google Drive alone.
- Google Drive is the only sharing authority initially. Keep provider identity explicit so future providers can supply the same access and persistence contracts.
- Use Cloudflare Durable Objects for realtime coordination.
- Preserve Available offline. Loss of connectivity or an expired permission check does not revoke a previously available offline copy. Confirmed permission loss stops writes to the shared file.
- Image bytes travel in complete Drive packages initially. A placeholder before the author's successful Drive publication is acceptable.
- E2EE is out of scope by user decision. Use HTTPS/WSS with a trusted backend, and retain self-contained, downloadable Drive packages that open without encryption keys.

Related contracts: [blob document format](./blob-document-format.md), [Drive transport](./drive-package-transport.md), and [image embedding](./image-embedding.md).

## Transport recommendation

Use WebSockets, with one Durable Object room per canonical provider/file identity. Send Yjs updates, synchronization messages, presence, and publication hints. Do not send image bytes in v1.

| Consideration  | WebSockets through a Durable Object                           | WebRTC peers                                                                           |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Authorization  | One server enforcement point for every connection and message | Each peer needs membership enforcement and revocation; signaling alone is insufficient |
| Connectivity   | One client/server connection                                  | Signaling plus ICE and potentially TURN                                                |
| Fan-out        | Room broadcasts with explicit quotas                          | Mesh connections grow with participants unless topology changes                        |
| Encryption     | TLS; trusted backend                                          | Transport encryption does not solve application key distribution or membership         |
| Recommendation | Initial transport                                             | Defer unless a measured need justifies it                                              |

WebRTC does not remove the need for a trusted authorization service. A removed peer can retain a live connection unless the remaining peers actively enforce updated permissions. WebSockets make enforcement more tractable, although Drive changes still need detection.

The room is a relay, not the durable document authority. Start without a persisted server Y.Doc or update log. New clients load Drive/local state and exchange bounded Yjs state-vector differences with authorized peers. Room restarts and empty rooms lose no acknowledged Drive save. Durable Object storage may contain minimal authorization epochs/session metadata, never document payloads by default. Decide hibernation and attachment storage with this privacy rule in mind.

## Configurable WebSocket update period

Expose a typed deployment configuration, `realtime.updatePeriodMs`, for client-to-room document-update batching. This is independent of Drive save timing, HTTP polling, and permission refresh/expiry. A proposed starting default is 100 ms; validate against typing latency and measured cost before release. This is deployment tuning initially, not a new user-facing settings screen.

Start a flush deadline when the first update enters an empty queue. Merge pending Yjs updates with Yjs's update-merging API and send one bounded binary application message per batch. Subsequent keystrokes must not reset the deadline: continuous typing still flushes once per configured period. Enforce finite validated bounds on the configuration, batch bytes, and queued bytes. Split oversized batches using a defined bounded protocol; on sustained backpressure stop realtime and recover from local persistence and authorized state-vector/Drive reconciliation rather than accumulating an unbounded queue.

Persist edits locally without waiting for the WebSocket flush. Send no empty periodic messages while idle. Flush on the scheduled deadline while connected and authorized; disconnect or page shutdown never makes delivery reliable and must not be required for durability. Reconnect first revalidates access, then reconciles current state rather than blindly replaying stale queued frames. Confirmed write loss discards the outgoing transport queue while preserving isolated local work under the recovery policy.

Coalesce presence separately using a configurable `presencePeriodMs` and keep only the latest unsent presence state. Initial synchronization and bounded publication hints need not wait for the typing batch; authentication, permission changes, and revocation are never delayed by this period. Start with immediate server fan-out of authorized received batches, avoiding a second latency window and an idle batching timer in the Durable Object. Recheck each recipient's grant before delivery.

Cloudflare's documented 20:1 ratio applies to **incoming WebSocket messages for Durable Object request billing**, not to actual invocations: each received message still triggers handling, and metrics reflect actual messages. Outgoing WebSocket messages are not charged as requests; connection/upgrade requests and duration remain separate considerations. Batching reduces incoming message count and handler overhead; it does not make the entire system cost one invocation per twenty edits. Use the hibernation API and measure duration as well as request counts. See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Acceptance includes continuous typing with bounded flush delay, merged-update equivalence, no idle sends, configuration validation, presence coalescing, oversized batches, slow recipients, disconnect/reconnect, and permission loss during a pending batch. Record incoming messages, batch sizes, end-to-end latency, and duration without logging document content.

## HTTP baseline and persistence

Retain local Yjs persistence and the existing conditional complete-package Drive save queue. Receiving a WebSocket update never acknowledges a Drive save or clears dirty state. Persist received updates locally and include them in normal complete-package reconciliation when authorized to write. Prevent transport echoes using transaction origins; remote changes still require durability tracking.

If all realtime endpoints are disabled, periodic HTTP checks, foreground/reconnect checks, and the existing ETag conflict/merge/retry path must converge concurrent writers. Realtime publication hints only accelerate an authorized metadata check. Lost, duplicate, or reordered hints cannot affect correctness.

On reconnect, validate current Drive access before joining a room or publishing accumulated edits. Never use a room's cached state to bypass a failed Drive open. A client that confirms a write downgrade must not send its pending edits to another editor to publish on its behalf. Already delivered edits cannot be recalled; offline edit creation time is not trustworthy evidence of authorization.

## Identity and server enforcement

For signed-in access, use the existing authenticated application session and its linked Google account. The server obtains credentials for that exact account and queries Drive itself. Never accept browser-supplied capability flags, an owner token, a guessed room identifier, or a claimed email as authorization. Keep OAuth tokens out of room URLs, frames, logs, and Durable Object attachments.

Use a canonical resource key such as `(provider = google-drive, fileId)`; local document IDs and content hashes are not sharing identities. Account changes invalidate sessions, local permission observations, and room grants. Account-scoped cache ownership is required to prevent another signed-in account opening a previous account's cached document through the normal app.

The admission flow is a same-origin HTTP request followed by a same-origin WebSocket upgrade, using either the authenticated account or the anonymous public-link grant described below. Check Origin and session identity; if using tickets, make them short-lived, single-use, bound to user/resource/rights, and never permanent share secrets. Grant no room data before authorization. Resource keys required for legitimate Drive link access must be supported without treating the link itself as an app authorization token.

Signed-in Drive access is evaluated as the requesting user, including group, inherited, domain, link, and shared-drive permissions. Do not reconstruct an ACL from direct permission entries. A successful metadata lookup is not sufficient when content download is prohibited; validate the binary-content read policy too. Require affirmative effective edit/content-modification capabilities for writes. Missing or ambiguous capabilities do not grant writes. Drive remains the final enforcement point on every actual upload.

Viewers may receive authorized content and send bounded presence/control requests. They may not send Yjs updates, initial document state, or state-vector responses containing document mutations. Yjs protocol replies must be classified by their content, not merely labeled as a harmless handshake. Readers and writers both require read authorization for room delivery. Presence, asset identifiers, and publication hints are also document-scoped data.

Frame limits, bounded sync responses, per-user/room rate limits, backpressure, participant limits, and malformed-update handling are required. No arbitrary peer URLs. Never log content or credentials. Treat authorized editors as capable of sending hostile updates; membership alone does not validate payload safety.

## Anonymous public-link collaboration

User-approved follow-up: public editable links support anonymous collaborative editing and publication without linking Google Drive or opening the picker. A linked editor registers their exact Google account as the file's publisher when opening a public editable file. The backend may continue publishing after that editor closes the tab; OAuth credentials remain in the existing encrypted account store.

- Registration is authenticated and resource-specific. It stores file/publisher references, never document content or plaintext OAuth credentials. Anonymous callers cannot select or substitute a publisher account.
- Before anonymous metadata reads, content reads, room admission/renewal, and every conditional upload, the backend verifies current public `anyone` access and effective download restrictions through Drive. Publisher edit capability alone is insufficient. Public readers receive read-only grants; public writers may edit. Private files never become accessible through this path.
- Anonymous visitors receive an opaque HttpOnly session identity. Room attachments contain identity, rights, expiry, and flow-control metadata only. Resource keys remain necessary for protected links and are not a replacement for public access checks.
- Anonymous complete-package reads and conditional saves use bounded same-origin HTTP endpoints, so realtime remains optional. Save requests carry an ETag and cannot create, trash, move, or target arbitrary publisher files. The backend streams bounded packages rather than decompressing an entire package in Worker memory.
- Publication is performed using the registered account, so Drive's final upload checks that account's rights. The backend separately enforces public rights before each upload; this is delegated publication, not anonymous OAuth access to Drive.
- A file needs a registered linked publisher before anonymous access works. Publisher account disconnection or loss of access stops delegated publication. Public permission removal stops future anonymous service access after detection/expiry; already downloaded copies remain recoverable under the local-copy policy.

Routine room authorization refreshes renew the current socket's grant in place. Successful refreshes do not disconnect collaborators or replay synchronization; failed refreshes cannot extend the existing grant past its deadline. Actual connection loss still revalidates and reconciles before sending edits.

Received edits remain locally persistent and dirty until Drive publication is verified. Passive replicas use a bounded durability fallback instead of the local typing save deadline. Publication hints share one coalesced check schedule, with faster bounded checks for missing assets. Local edits retain their independent save deadline.

## Revocation and offline access

Separate local-copy availability from authorization to use the shared remote resource. A single readOnly boolean cannot represent both.

| Observation                           | Local app behavior                                                                                                              | Remote behavior                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Confirmed editable                    | Edit and persist locally                                                                                                        | Permit authorized writes and reads                                      |
| Confirmed view-only                   | Render; disable document mutation                                                                                               | Receive only; no shared writes                                          |
| Offline or temporary provider failure | Preserve previously permitted offline use and mark unconfirmed status                                                           | Stop room traffic when server authorization expires; no bypass of Drive |
| Confirmed no read access              | Close shared editor, detach live binding and revoke view resources; retain isolated local recovery data pending recovery policy | Disconnect, cancel queued work, deny new reads and writes               |
| Deleted or unavailable file           | Block remote use; avoid claiming a specific ACL change without evidence                                                         | Deny until successfully revalidated                                     |

On an editor-to-viewer downgrade, freeze edits and shared publication immediately on confirmation. Preserve unsynced work separately; do not silently discard it or merge it back through another participant. On complete access loss, stop exposing the shared document in the editor. Users may explicitly recover retained unsynced work into a detached local copy after total revocation. Recovery never writes to or rejoins the shared file; the existence of downloaded bytes cannot be undone.

Show persistent access state in the existing status indicator: orange for offline/unverified state, red for confirmed loss, with concise wording such as “You no longer have access to this file.” This is status, not a duplicate inline error panel. Use Sonner once for action failures. Do not report “saved to Drive” for local-only work.

Server authorization uses short-lived grants, independently of offline local-copy policy. Proposed starting point: refresh every 30 seconds, maximum 60-second server grant, checking expiry before every inbound mutation and outbound delivery. These are proposed operating values, not a guaranteed time from a Drive sharing click: provider visibility, quotas, and failures affect detection. Expired grants stop room delivery until revalidated; timer delays, hibernation, restarts, or a busy room must not extend them. A write downgrade suppresses already queued mutations too. Define serialization/epoch checks so a late successful authorization request cannot resurrect a revoked grant.

Use HTTP permission checks even with WebSockets disabled. Check on open, foreground, reconnect, and a bounded active-session schedule. Google push notifications may accelerate revalidation but cannot be the sole revocation mechanism. Verify behavior for permission-only changes and lost notifications in real accounts before relying on them. Distinguish authentication expiry, quota errors, and transient failures from confirmed access loss; an inaccessible/deleted result blocks remote use without revealing which case occurred.

No system can erase exported or cached plaintext from a hostile former collaborator. Offline use also means a disconnected client cannot learn immediately about revocation. The guarantee is denial of future authorized service access after detection/expiry, plus enforcement in the cooperative app after confirmation, not retroactive removal of downloaded information.

## Images

Keep image source records in Yjs and exact hash-addressed bytes in the existing document asset repository. The author persists bytes before inserting a reference and requests an urgent complete-package save. Other clients may receive the reference first and show its reserved-size placeholder.

After successful publication, send a bounded publication hint. The recipient checks Drive with its own authorization, downloads and verifies the package, imports assets, and refreshes rendering without a document edit or undo entry. Missing-asset retries must recover when the hint is lost or realtime is absent. Never mark a save successful while required assets are missing.

If the author disconnects before publication, bytes may remain unavailable until that author returns. Another client must not publish an incomplete package. No sibling Drive asset files, separate ACLs, base64 in Yjs, or new hosted asset service. Revisit binary realtime transfer only after measuring the accepted placeholder delay.

## Security and portable copies

Use HTTPS/WSS transport encryption, authenticated sessions, and server-enforced Drive permissions. The Durable Object can process plaintext updates; do not claim end-to-end encryption. Application-level encryption, document keys, key distribution, and key rotation are out of scope.

Keep the existing self-contained `.concept` package format. Authorized downloads remain portable and open independently, including offline, without a key service or realtime connection. The trusted relay must still avoid persisting or logging document payloads. Removing access blocks future service access; it cannot revoke already downloaded copies.

## Current integration gaps

Source review on 2026-11-06, not a full security audit:

- `drive/api.ts:isDriveFileReadOnly` currently treats missing capability data as writable. Replace this with explicit access states and affirmative write grants for the new security contract.
- `sync.ts` refreshes read-only state during download and compares permissions during remote checks, but the inspected flow does not establish a full revoked-session teardown or independent access state machine.
- `drive/token.server.ts` already maps the authenticated session to a linked Google account. Reuse that identity path; add server-side resource checks rather than trusting client tokens or cached UI flags.
- Existing package, asset resolver, urgent save, publication, and incomplete-snapshot rules provide the persistence baseline. Do not replace them with a generic websocket provider's durability assumptions.

## Delivery plan and acceptance

1. Agree on revocation/recovery UX, server grant timings, sharing modes, and batching defaults. Verify binary read restrictions and current OAuth `drive.file` behavior for intended sharing paths.
2. Implement provider-neutral access states and HTTP-only enforcement. Prove viewer, downgrade, revocation, offline use, account switching, and conflict recovery before adding realtime.
3. Add the authenticated Durable Object WebSocket relay, bounded Yjs exchange, presence, and expiring per-user grants. Exercise hibernation and restart without storing document content.
4. Connect existing publication hints and asset resolution. Keep binary image transfer out of scope.
5. Measure collaboration latency, message volume, and Durable Object duration; tune the configurable batching defaults without changing HTTP correctness.

Required scenarios: realtime completely blocked; two offline/concurrent writers later converging via Drive; viewer sending forged update/handshake frames; guessed room and cross-account cache access; permission downgrade without content changes; full removal while connected; revoke during queued broadcast/save/asset fetch; lost notifications; grant expiry through hibernation; delayed authorization responses; Drive quota/auth failures; removed group/inherited access; link-sharing behavior; incomplete images and lost publication hints; lost upload response; and no content/credentials in logs or persisted room attachments. Live two-account Drive tests are essential.

## Implementation decisions

- Explicit recovery of retained unsynced work into a detached local copy is allowed after confirmed total access loss.
- Accept all effective Drive sharing modes, including anyone-with-link, with authenticated own-account access and the user-approved delegated anonymous public-link path. The existing OAuth `drive.file` scope may still require selecting a file through the Drive picker.
- Start with a 100 ms update period, separate presence coalescing, a 30-second refresh, and a 60-second maximum room grant. These are deployment defaults requiring live quota and latency validation, not provider revocation guarantees.

## Reference material

- [Cloudflare WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/): room lifecycle support, not an authorization mechanism.
- [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections): signaling and ICE/STUN/TURN requirements.
- [Drive file capabilities](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) and [sharing](https://developers.google.com/workspace/drive/api/guides/manage-sharing): effective current-user capabilities and sharing semantics.
- [Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push): watch-channel lifecycle; retain independent checks.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): incoming WebSocket message billing and separate duration charges.
