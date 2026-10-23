# Authentication and identity review

Reviewed 2026-10-23. Generated files excluded. No application code changed.

## Severity summary

Critical: none identified. High: none identified. Medium: four findings. Low: one finding.

## Medium

### M1. Non-discoverable credentials can become the only sign-in method

Locations: src/lib/auth/server.ts:84; migrations/0003_sign_in_guards.sql:4-6; src/lib/auth/schema.test.ts:42-51.

Status: FIXED. Triage confirmed that leaving passkey authenticatorSelection residentKey as plugin default ("preferred") allowed registering non-discoverable credentials. In this username-less product, signed-out authentication cannot supply allowCredentials without a prior session, which would lock out users who unlinked Google after registering a non-discoverable security key. Fixed in src/lib/auth/server.ts by explicitly configuring authenticatorSelection with residentKey: 'required' and userVerification: 'preferred' in passkey plugin options, enforcing that only discoverable credentials can be created during passkey registration. Validated with unit test in src/lib/auth/server.test.ts asserting residentKey: 'required'.

Evidence: installed @better-auth/passkey/dist/index.mjs:168-183 permits preferred resident keys; :265-285 populates allowCredentials only for a session user. W3C describes discoverable credentials as necessary when no credential IDs are supplied: https://www.w3.org/TR/webauthn-3/.

Fix: require residentKey: "required" for this username-less product. Account for existing credentials: verify discoverability/usability before permitting removal of the last alternative, or implement a carefully protected account-identification flow for non-discoverable credentials. Test signed-out authentication after unlinking Google, including a non-resident authenticator.

### M2. OAuth callback secrets are eligible for persistent invocation logging

Locations: wrangler.jsonc:39-52; src/routes/api/auth/$.ts:5-10.

Status: DOCUMENTED OVERLAP (OWNED BY CONFIG AGENT). Triage confirmed: wrangler.jsonc:41 specifies redact_query_string: false while persistent invocation logs and traces are enabled at 100% sampling. GET OAuth callbacks include authorization codes and state in the query string, allowing sensitive transient secrets into log retention. As instructed, wrangler.jsonc and observability configuration are owned by the config agent (finding SEC-01 in 07-config-and-migrations.md); documented here to prevent conflicting modifications.

Fix: set observability.redact_query_string to true; inspect downstream sinks for URL capture and restrict access/retention of existing records. Verify with a synthetic callback that code/state never appear in persisted invocation metadata. Cloudflare reference: https://developers.cloudflare.com/workers/observability/logs/workers-logs/.

### M3. Rate limiting is local to a Worker isolate

Location: src/lib/auth/server.ts:49-51,115.

Status: BLOCKED / ARCHITECTURAL LIMITATION. Triage confirmed: Better Auth defaults to an in-memory rate-limiter map, meaning rate limits are enforced within individual Worker isolates rather than globally across Cloudflare edge locations or surviving isolate recycles. However, resolving global edge rate limiting requires infrastructure configuration: either Cloudflare edge WAF rate-limiting rules, a Durable Object rate-limit binding in wrangler.jsonc (owned by config agent), or a D1-backed rate-limit table (which requires D1 schema migrations owned by domain 7 and would add single-writer lock contention to global auth requests). This abuse-protection gap is blocked pending platform/infrastructure coordination.

Fix: configure an atomic shared limiter, such as a Durable Object-backed custom store, or deploy equivalent Cloudflare edge limits. If choosing Better Auth database storage, add its required schema and validate its atomic behavior on D1. Test requests across multiple instances. Better Auth explicitly cautions about in-memory storage in serverless environments: https://better-auth.com/docs/concepts/rate-limit.

### M4. Passkey deletion accepts an old session without reauthentication

Locations: src/lib/auth/server.ts:83-86; src/components/account/PasskeySettings.tsx:165.

Status: FIXED. Triage confirmed that @better-auth/passkey's /passkey/delete-passkey endpoint applied only sessionMiddleware and resource ownership checks rather than freshSessionMiddleware, allowing stale sessions to delete passkeys when another login method was present. Fixed in src/lib/auth/server.ts by enforcing freshSessionMiddleware in hooks.before when ctx.path === '/passkey/delete-passkey', returning HTTP 403 SESSION_NOT_FRESH for stale sessions. Validated with HTTP-level regression test in src/lib/auth/passkey-deletion.test.ts proving a stale session (>5m) is rejected with 403 SESSION_NOT_FRESH while a fresh session succeeds, plus hook delegation coverage in src/lib/auth/server.test.ts.

Fix: enforce server-side fresh-session or stronger step-up authentication before passkey deletion. Keep the ownership checks and database last-method guard. Add an HTTP-level regression test proving an authenticated but stale session cannot delete a credential. A confirmation dialog alone does not address this threat.

## Low

### L1. Fresh-session errors have no in-app reauthentication recovery

Locations: src/components/account/PasskeySettings.tsx:43-57,76; src/components/account/use-account-settings.ts:84-99,133-138; src/components/account/AccountMenu.tsx:70-74.

Status: FIXED. Triage confirmed: Better Auth rejects passkey registration, passkey deletion, and Google unlinking when the session freshness window expires (HTTP 403 SESSION_NOT_FRESH). Previously, the UI displayed a dead-end error with no option to reauthenticate while signed in. Fixed by adding ReauthDialog (with isFreshSessionError recognizer) in src/components/account/ReauthDialog.tsx, and integrating recovery into PasskeySettings, useAccountSettings, and AccountSettingsDialog. When a fresh-session error is intercepted, the dialog prompts reauthentication via passkey or Google, verifies that the resulting session user ID matches the current user, and automatically resumes the pending operation. Cancelled or mismatched reauthentication is cleanly reported without executing the pending mutation. Validated with integration tests in src/components/account/AccountManager.test.tsx covering passkey registration recovery, Google unlinking recovery, prompt cancellation, and mismatched user ID rejection.

Fix: recognize SESSION_NOT_FRESH, offer Google/passkey reauthentication while signed in, verify the resulting user identity, then allow the pending operation to be retried. Test fresh versus stale sessions and cancelled reauthentication.

## Reviewed controls and negative findings

- The custom D1 updates use bound parameters and constrain account/user ownership. No SQL injection or cross-user account selection was identified in these handlers.
- OAuth tokens are encrypted by Better Auth; unused ID tokens are discarded. Public token retrieval/refresh/account-info endpoints are disabled while internal server APIs remain available.
- Storage consent uses server-trusted OAuth state, verifies the linked owner, and checks actual callback grants rather than merged historical scopes. The WeakMap key uses the same request-local OAuth-state object in the inspected library implementation.
- Implicit account linking is disabled. Explicit linking applies the library's same-email restriction by default.
- The inspected OneTap endpoint verifies Google ID-token audience/signature through the library. No custom JWT decoding is used as production authentication validation.
- Production HTTPS base URLs yield Secure, HttpOnly, SameSite=Lax, host-only cookies in the installed library. Cross-subdomain cookies and cookie session caching are not enabled.
- Better Auth's origin/CSRF protections are not disabled. No concrete CSRF, XSS, timing-comparison, or session-signature bypass was established by this review.
- Foreign-key cascades and the database last-method guards are tested. Those guards prevent row-count lockout, with the credential-usability exception in M1.
- Runtime auth uses cloudflare:workers bindings. node:sqlite is confined to the schema test. nodejs_compat is configured. No specific incompatible runtime crypto API was identified by static inspection.

## Validation and limits

Passed: 4 test files, 43 tests using:

node node_modules/vitest/vitest.mjs run src/lib/auth/schema.test.ts src/lib/auth/server.test.ts src/components/account/AccountManager.test.tsx src/components/account/OneTapPrompt.test.tsx

server.test.ts mocks betterAuth and API/session calls. schema.test.ts uses Node SQLite rather than D1. These tests do not establish real cookie propagation, callback/state/PKCE enforcement, replay resistance, Workers cryptography, or hardware WebAuthn compatibility. Add focused Workers HTTP integration tests with real Better Auth and browser/authenticator tests for these boundaries.

No live deployment, secret values, Google console configuration, production D1 contents, or deployed edge/WAF rules were inspected. In particular, required secret declarations do not prove the secrets are deployed; no claim of missing deployed secrets is made.

## Integration corrections

OAuth query redaction is fixed by d38bfea. Reauthentication now fails closed on missing/error sessions and verifies the expected identity before passkey action retry. Google starts a redirect and never retries the stale action before callback; the dialog instructs users to retry their action after returning. M3 is assigned to a focused shared-rate-limit continuation.
