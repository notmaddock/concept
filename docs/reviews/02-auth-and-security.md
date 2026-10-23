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

Query-string redaction is explicitly disabled while invocation logs and persistent traces are enabled at full sampling. GET OAuth callbacks include authorization code and state in the request URL. Those values can therefore enter observability storage and integrations, expanding access beyond the auth service. This is a confidentiality issue; PKCE, short expiry, state binding, and single-use codes limit replay, so this finding does not establish an account-takeover exploit.

Fix: set observability.redact_query_string to true; inspect downstream sinks for URL capture and restrict access/retention of existing records. Verify with a synthetic callback that code/state never appear in persisted invocation metadata. Cloudflare reference: https://developers.cloudflare.com/workers/observability/logs/workers-logs/.

### M3. Rate limiting is local to a Worker isolate

Location: src/lib/auth/server.ts:49-51,115.

No shared rate-limit storage or edge rate-limit configuration is provided in the reviewed repository. Better Auth defaults to an in-memory map, which is shared within an isolate but not across Workers isolates/regions and is lost on restart. The configured cf-connecting-ip header improves IP integrity but does not make counters global. Distributed auth traffic can exceed the intended per-client limits, increasing OAuth verification, challenge creation, D1 load, and cost. This is an abuse-protection gap, not a demonstrated signature or login bypass.

Fix: configure an atomic shared limiter, such as a Durable Object-backed custom store, or deploy equivalent Cloudflare edge limits. If choosing Better Auth database storage, add its required schema and validate its atomic behavior on D1. Test requests across multiple instances. Better Auth explicitly cautions about in-memory storage in serverless environments: https://better-auth.com/docs/concepts/rate-limit.

### M4. Passkey deletion accepts an old session without reauthentication

Locations: src/lib/auth/server.ts:83-86; src/components/account/PasskeySettings.tsx:165.

Status: FIXED. Triage confirmed that @better-auth/passkey's /passkey/delete-passkey endpoint applied only sessionMiddleware and resource ownership checks rather than freshSessionMiddleware, allowing stale sessions to delete passkeys when another login method was present. Fixed in src/lib/auth/server.ts by enforcing freshSessionMiddleware in hooks.before when ctx.path === '/passkey/delete-passkey', returning HTTP 403 SESSION_NOT_FRESH for stale sessions. Validated with HTTP-level regression test in src/lib/auth/passkey-deletion.test.ts proving a stale session (>5m) is rejected with 403 SESSION_NOT_FRESH while a fresh session succeeds, plus hook delegation coverage in src/lib/auth/server.test.ts.

Fix: enforce server-side fresh-session or stronger step-up authentication before passkey deletion. Keep the ownership checks and database last-method guard. Add an HTTP-level regression test proving an authenticated but stale session cannot delete a credential. A confirmation dialog alone does not address this threat.

## Low

### L1. Fresh-session errors have no in-app reauthentication recovery

Locations: src/components/account/PasskeySettings.tsx:43-57,76; src/components/account/use-account-settings.ts:84-99,133-138; src/components/account/AccountMenu.tsx:70-74.

Better Auth rejects passkey registration and Google unlinking once the session exceeds its freshness window. The UI displays the error but does not offer reauthentication or resume the operation. Sign-in actions are hidden while already signed in. Users can recover by signing out and back in, but must discover this themselves; repeatedly retrying the requested action cannot succeed.

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
