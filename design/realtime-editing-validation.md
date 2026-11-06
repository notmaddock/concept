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
