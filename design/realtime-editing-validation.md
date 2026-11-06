# Realtime validation

Run the automated repository checks with `pnpm run validate`. The relay stores authorization metadata and WebSocket attachments, never a document or update log. Realtime batches and client performance measures contain counts, byte sizes, and timing only.

## Implementation verification

- `pnpm run validate` passed: formatting, generated routes and bindings, lint, typechecking, 453 tests, and production build.
- A local Workers runtime smoke check delivered a Yjs update between two actual relay sockets and rejected a forged viewer mutation with close code 4002.
- Account cache migration retains previous bytes in a separate recovery entry before replacing the canonical cache after a fresh authorized Drive read. Other tabs holding the old cache must close before migration can proceed.
- Live two-account Drive checks, provider permission propagation, and latency/cost measurements remain pending on the PR preview.

## Two-account preview checks

Use two browser profiles, each signed into a different Google account and the same PR preview. Select the shared `.concept` file through the Google Drive picker in both profiles when required by the `drive.file` OAuth scope.

1. Share a document as an editor. Type continuously in both profiles; verify both text and collaborator cursors converge. Verify saving to Drive completes independently of the socket.
2. Block `/api/realtime/*` in both profiles. Edit concurrently, including offline edits followed by reconnect. Verify HTTP checks and conditional Drive saves converge without losing either writer's work.
3. Add an image, then disconnect its author before Drive publication. Verify the other profile shows a placeholder and never publishes an incomplete package. Reconnect the author and verify the image resolves, including with publication hints blocked.
4. Change an editor to a viewer without editing file content. Verify mutation controls freeze, pending transport updates stop, and retained unsynced work can only be recovered into a local copy. A subsequent write grant must not automatically publish quarantined edits.
5. Remove all access while the shared editor is open. Verify the access status turns red and the editor and image resources detach after detection. Recover local work explicitly and verify the recovered copy has no Drive association.
6. Restore sharing and reopen the shared file. Change the signed-in account and verify the previous account's cached document cannot open through the normal shared-file route.
7. Exercise inherited/group/shared-drive access and anyone-with-link access, including a link requiring a resource key. Disable download/copy where supported and verify the relay refuses binary-content access.
8. Leave a profile suspended past the maximum grant lifetime, then resume. Verify access is checked before updates or room delivery resume. Disconnect everyone and reopen; room restarts must not lose acknowledged Drive saves.
9. Observe the network while idle: there should be no periodic empty document updates. Compare incoming message counts and batch sizes during continuous typing, end-to-end typing latency, and Cloudflare duration with the configured periods.

Provider propagation and quota behavior affect observed permission detection time. Record the preview URL, account roles, sharing mode, observed timing, and failures without recording credentials or private document content.

## Follow-up checks for public links and request volume

1. Set a file to “anyone with the link can edit.” Open it once with a linked editor to register the publisher. Open the Concept URL in a browser with no Google Drive/app login: it should load without the picker, collaborate, and conditionally save to the same Drive file even after the linked editor closes their tab.
2. With one editor typing and another only watching, inspect request counts for at least two minutes. Received edits should not trigger the local three-second Drive save cycle. Publication hints share a 30-second check window (five seconds when assets are missing), while unacknowledged remote edits retain a maximum 60-second durability fallback.
3. Observe the WebSocket connection through several 30-second permission refreshes, including a deliberately slow response. The same socket should remain open; a failed refresh cannot extend its grant past expiry. Downgrades and confirmed revocation still stop writes immediately on observation.
4. Change public editing to viewing, then remove public sharing. Anonymous clients must become read-only or detach; a privileged publisher account must never substitute its private access for public access. Check both HTTP-only and realtime paths.
5. Disconnect the publishing account from Concept. Publishing registrations must be withdrawn before sign-out, including when registration was already in flight. A private file, a guessed resource key, or an anonymous registration request must never expose the publisher's credentials or private content.
6. Let the application login expire while an account-owned private document is available offline. Verify its local copy remains unverified/offline and recoverable rather than being treated as a revoked anonymous public file. Explicit picker authorization should switch a public fallback copy back to the signed-in account's access path.
