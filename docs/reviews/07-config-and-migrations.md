# Code Review & Issue Scan Report: Database Migrations, Build Config & Environment Setup

---

## Executive Summary

A comprehensive architectural and security review was performed across database migrations, Cloudflare Wrangler configuration, Vite/Vitest setup, TypeScript configuration, ESLint rules, environment schemas, and package scripts.

The review identified **1 Critical**, **3 High**, **4 Medium**, and **4 Low** severity issues. The most significant finding is a database trigger bug in [`0003_sign_in_guards.sql`](file:///home/maddock/concept/migrations/0003_sign_in_guards.sql) that bricks user deletion in Better Auth, along with a security exposure in [`wrangler.jsonc`](file:///home/maddock/concept/wrangler.jsonc) where query string unredaction persists OAuth authorization codes into Cloudflare observability logs.

---

## Issue Matrix

| ID          | Category           | Severity     | File Reference                                                                                                                                                                                   | Summary                                                                                   |
| ----------- | ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **MIG-01**  | Database / Auth    | **Critical** | [`0003_sign_in_guards.sql:2-10`](file:///home/maddock/concept/migrations/0003_sign_in_guards.sql#L2-L10)                                                                                         | `account_keep_sign_in_method` trigger breaks Better Auth `deleteUser`                     |
| **SEC-01**  | Security / Leaks   | **High**     | [`wrangler.jsonc:41`](file:///home/maddock/concept/wrangler.jsonc#L41)                                                                                                                           | `redact_query_string: false` logs and persists OAuth authorization codes                  |
| **MIG-02**  | Migrations / DDL   | **High**     | [`0004_storage_consent.sql:2`](file:///home/maddock/concept/migrations/0004_storage_consent.sql#L2)                                                                                              | Destructive, non-idempotent full-table update (`UPDATE account SET idToken = NULL`)       |
| **ENV-01**  | Env / CI/CD        | **High**     | [`.gitignore:18`](file:///home/maddock/concept/.gitignore#L18), [`src/env.ts:13`](file:///home/maddock/concept/src/env.ts#L13)                                                                   | `.env.production` / `.env.staging` untracked causing silent Google Auth failure in CI/CD  |
| **CFG-01**  | Wrangler / D1      | **Medium**   | [`wrangler.preview-migrations.jsonc:1-11`](file:///home/maddock/concept/wrangler.preview-migrations.jsonc#L1-L11), [`wrangler.jsonc:59-71`](file:///home/maddock/concept/wrangler.jsonc#L59-L71) | Fragmented preview config file instead of standard Wrangler environments                  |
| **MIG-03**  | Database / Indexes | **Medium**   | [`0001_auth.sql:10-20,38-45`](file:///home/maddock/concept/migrations/0001_auth.sql#L10-L20)                                                                                                     | Missing indexes on `session.expiresAt` and `verification.expiresAt`                       |
| **CFG-02**  | Build / TS         | **Medium**   | [`tsconfig.json:6,14`](file:///home/maddock/concept/tsconfig.json#L6-L14)                                                                                                                        | Stale config in `include` (`vite.config.js`) and missing `@cloudflare/workers-types`      |
| **ENV-02**  | Env Validation     | **Medium**   | [`src/env.ts:5-7`](file:///home/maddock/concept/src/env.ts#L5-L7)                                                                                                                                | Dead server variable (`SERVER_URL`) while real worker secrets lack validation             |
| **CFG-03**  | Vite / Vitest      | **Low**      | [`vitest.config.ts:6-13`](file:///home/maddock/concept/vitest.config.ts#L6-L13)                                                                                                                  | Vitest config does not share Vite plugins (SVGR, Tailwind) and duplicates path aliases    |
| **LINT-01** | ESLint             | **Low**      | [`eslint.config.js:27,48`](file:///home/maddock/concept/eslint.config.js#L27-L48)                                                                                                                | Redundant error throw rules (`@typescript-eslint/only-throw-error` + `no-throw-literal`)  |
| **SCR-01**  | Scripts            | **Low**      | [`package.json:13`](file:///home/maddock/concept/package.json#L13)                                                                                                                               | `preview` script invokes `wrangler dev` directly on worker entry rather than Vite preview |
| **DEP-01**  | Dependencies       | **Low**      | [`package.json:44`](file:///home/maddock/concept/package.json#L44)                                                                                                                               | Moderate advisory on `postcss-selector-parser` (<7.1.6) via `@tailwindcss/typography`     |

---

## Detailed Findings

### Critical

#### MIG-01: Sign-in guard trigger blocks Better Auth user deletion

- **File**: [`migrations/0003_sign_in_guards.sql#L2-L18`](file:///home/maddock/concept/migrations/0003_sign_in_guards.sql#L2-L18)
- **Problem**:
  The trigger `account_keep_sign_in_method` aborts deletion if the user exists and has no other account or passkey:

  ```sql
  CREATE TRIGGER "account_keep_sign_in_method"
  BEFORE DELETE ON "account"
  WHEN EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."userId")
    AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = OLD."userId" AND "id" != OLD."id")
    AND NOT EXISTS (SELECT 1 FROM "passkey" WHERE "userId" = OLD."userId")
  BEGIN
    SELECT RAISE(ABORT, 'Add another sign-in method before removing this one.');
  END;
  ```

  In Better Auth's internal adapter (`internal-adapter.mjs:249-256`), user deletion is executed programmatically in steps:
  1. `await deleteManyWithHooks([{ field: "userId", value: userId }], "account")`
  2. `await deleteWithHooks([{ field: "id", value: userId }], "user")`

  Because `account` rows are deleted **before** the `user` row, `EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."userId")` evaluates to `TRUE`. For the last account of the user, the trigger fires and raises an `ABORT` error:
  `sqlite3.IntegrityError: Add another sign-in method before removing this one.`

  Consequently, **users can never delete their account** via Better Auth's `/delete-user` endpoint.

- **Actionable Fix**:
  Better Auth already provides application-level protection against unlinking the last account in `/unlink-account`. If database-level enforcement is necessary, configure SQLite cascading deletes (`PRAGMA foreign_keys = ON;`) and execute `DELETE FROM "user"` directly, or check whether the user record itself is marked for deletion. If retaining the trigger, do not enforce sign-in method checks when all accounts belonging to the user are being purged, or handle account unlinking checks via Better Auth hooks in [`src/lib/auth/server.ts`](file:///home/maddock/concept/src/lib/auth/server.ts) instead of a raw SQLite `BEFORE DELETE` trigger.

---

### High

#### SEC-01: Unredacted query string logging exposes OAuth authorization codes

- **File**: [`wrangler.jsonc#L41`](file:///home/maddock/concept/wrangler.jsonc#L41)
- **Problem**:

  ```jsonc
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "redact_query_string": false, // <-- Security exposure
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "persist": true,
      "invocation_logs": true
    }
  }
  ```

  Cloudflare Workers Observability by default redacts URL query strings to avoid leaking secrets. Setting `"redact_query_string": false` with `"persist": true` forces Cloudflare to log and persist full query parameters.

  During Google OAuth redirects (`/api/auth/callback/google?code=4/0A...&state=...`), authorization codes and CSRF state parameters will be logged in plain text and stored in Cloudflare's log storage. Anyone with viewer access to Cloudflare logs or logpush sinks can access transient OAuth codes.

- **Actionable Fix**:
  Change `"redact_query_string": false` to `"redact_query_string": true` (or remove the line to use Cloudflare's secure default):
  ```jsonc
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "redact_query_string": true,
  ```

---

#### MIG-02: Destructive, non-idempotent full-table update in migration 0004

- **File**: [`migrations/0004_storage_consent.sql#L1-L2`](file:///home/maddock/concept/migrations/0004_storage_consent.sql#L1-L2)
- **Problem**:
  ```sql
  ALTER TABLE account ADD COLUMN driveConnected INTEGER NOT NULL DEFAULT 0;
  UPDATE account SET idToken = NULL;
  ```
  1. `UPDATE account SET idToken = NULL;` executes an unconditional full-table write within the D1 migration transaction. In D1 / SQLite, this acquires an exclusive table lock.
  2. The update permanently strips `idToken` from all existing user accounts in the database.
  3. `ALTER TABLE account ADD COLUMN` in SQLite does not support `IF NOT EXISTS`. If this migration fails midway or is re-run, SQLite throws `duplicate column name: driveConnected`.
- **Actionable Fix**:
  1. Move token clearing into application code if needed (as already done in [`src/lib/auth/server.ts#L61-L69`](file:///home/maddock/concept/src/lib/auth/server.ts#L61-L69) via `databaseHooks.account`).
  2. Avoid mixing structural DDL changes with mass destructive data mutations in a single migration file.

---

#### ENV-01: Production & staging `.env` files are ignored by git, causing build failures in CI/CD

- **File**: [`.gitignore#L18`](file:///home/maddock/concept/.gitignore#L18), [`src/env.ts#L13`](file:///home/maddock/concept/src/env.ts#L13)
- **Problem**:
  [`.gitignore`](file:///home/maddock/concept/.gitignore) specifies:

  ```gitignore
  .env*
  ```

  This ignores `.env.production` and `.env.staging`. However, [`package.json#L22`](file:///home/maddock/concept/package.json#L22) defines:

  ```json
  "deploy:preview": "pnpm exec vite build --mode staging && ...",
  "deploy": "pnpm run build && ..."
  ```

  Both builds depend on `VITE_GOOGLE_CLIENT_ID` being present at build time to embed into the client bundle. Because `.env.production` and `.env.staging` are gitignored and not committed, a clean clone or CI/CD pipeline will build the client with `VITE_GOOGLE_CLIENT_ID = undefined`.

  Because [`src/env.ts`](file:///home/maddock/concept/src/env.ts) treats `VITE_GOOGLE_CLIENT_ID` as `.optional()`, the build silently passes, but Google OneTap and Google Sign-In fail on the deployed site.

- **Actionable Fix**:
  Either:
  1. Whitelist non-secret env files in [`.gitignore`](file:///home/maddock/concept/.gitignore):
     ```gitignore
     !.env.production
     !.env.staging
     ```
     _(Note: Google Client IDs are public client-side identifiers, not secrets)._
  2. Or inject `VITE_GOOGLE_CLIENT_ID` from the environment / Wrangler config during build via `vite.config.ts`:
     ```ts
     define: {
       'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID),
     }
     ```

---

### Medium

#### CFG-01: Redundant `wrangler.preview-migrations.jsonc` file

- **File**: [`wrangler.preview-migrations.jsonc#L1-L11`](file:///home/maddock/concept/wrangler.preview-migrations.jsonc#L1-L11), [`wrangler.jsonc#L59-L71`](file:///home/maddock/concept/wrangler.jsonc#L59-L71), [`package.json#L21`](file:///home/maddock/concept/package.json#L21)
- **Problem**:
  `wrangler.preview-migrations.jsonc` was created solely because `wrangler d1 migrations apply` does not read from Wrangler's `previews` configuration block. It also lacks a top-level `"name"` property.
- **Actionable Fix**:
  Configure a standard Wrangler named environment `env.preview` in [`wrangler.jsonc`](file:///home/maddock/concept/wrangler.jsonc):
  ```jsonc
  "env": {
    "preview": {
      "d1_databases": [
        {
          "binding": "AUTH_DB",
          "database_name": "auth_db_preview",
          "database_id": "6ebb8d62-bf58-4ff1-8c3e-98a8c4d14455",
          "migrations_dir": "migrations"
        }
      ]
    }
  }
  ```
  Update [`package.json`](file:///home/maddock/concept/package.json):
  ```json
  "db:migrate:preview": "wrangler d1 migrations apply AUTH_DB --remote --env preview"
  ```
  Delete [`wrangler.preview-migrations.jsonc`](file:///home/maddock/concept/wrangler.preview-migrations.jsonc).

---

#### MIG-03: Missing indexes on `session.expiresAt` and `verification.expiresAt`

- **File**: [`migrations/0001_auth.sql#L10-20,38-45`](file:///home/maddock/concept/migrations/0001_auth.sql#L10-L20)
- **Problem**:
  Better Auth regularly executes cleanup queries to purge expired sessions (`DELETE FROM session WHERE expiresAt < ?`) and verification tokens (`DELETE FROM verification WHERE expiresAt < ?`).
  Without indexes on `session(expiresAt)` and `verification(expiresAt)`, every cleanup or expiration query performs a full-table scan.
- **Actionable Fix**:
  Add an index migration:
  ```sql
  CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session" ("expiresAt");
  CREATE INDEX IF NOT EXISTS "verification_expiresAt_idx" ON "verification" ("expiresAt");
  ```

---

#### CFG-02: Stale `vite.config.js` in `tsconfig.json` and missing Cloudflare Worker types

- **File**: [`tsconfig.json#L6,14`](file:///home/maddock/concept/tsconfig.json#L6-L14)
- **Problem**:
  1. [`tsconfig.json#L6`](file:///home/maddock/concept/tsconfig.json#L6) includes `"vite.config.js"`, but the project uses [`vite.config.ts`](file:///home/maddock/concept/vite.config.ts).
  2. [`tsconfig.json#L4`](file:///home/maddock/concept/tsconfig.json#L4) includes `"eslint.config.js"` and `"prettier.config.js"`, but `"allowJs": true` is not set in `compilerOptions`.
  3. `"types": ["vite/client"]` does not reference Cloudflare Workers types. While [`worker-configuration.d.ts`](file:///home/maddock/concept/worker-configuration.d.ts) provides ambient declarations, if typegen has not run, TypeScript cannot resolve `cloudflare:workers`.
- **Actionable Fix**:
  In [`tsconfig.json`](file:///home/maddock/concept/tsconfig.json):
  - Replace `"vite.config.js"` with `"vite.config.ts"`.
  - Add `"allowJs": true` if checking JS configs, or remove them from `include`.

---

#### ENV-02: `src/env.ts` defines dead variables and omits server-side Worker secrets

- **File**: [`src/env.ts#L4-7`](file:///home/maddock/concept/src/env.ts#L4-L7)
- **Problem**:
  ```ts
  export const env = createEnv({
    server: {
      SERVER_URL: z.string().url().optional(),
    },
    ...
  })
  ```
  `SERVER_URL` is completely unused across the entire codebase. Meanwhile, server runtime secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_SECRET`) are read via `cloudflare:workers` without any runtime schema validation.
- **Actionable Fix**:
  Remove `SERVER_URL` from [`src/env.ts`](file:///home/maddock/concept/src/env.ts). If `@t3-oss/env-core` is intended strictly for client-side environment validation, remove the unused `server` object entirely.

---

### Low

#### CFG-03: `vitest.config.ts` does not inherit Vite plugins or path resolution

- **File**: [`vitest.config.ts#L5-13`](file:///home/maddock/concept/vitest.config.ts#L5-L13)
- **Problem**:
  [`vite.config.ts`](file:///home/maddock/concept/vite.config.ts) enables native `resolve: { tsconfigPaths: true }` and SVGR plugin `svgr()`, whereas [`vitest.config.ts`](file:///home/maddock/concept/vitest.config.ts) manually defines aliases `'@'` and `'#'`. If a component imports an SVG as a React component via `?react`, Vitest will fail.
- **Actionable Fix**:
  Use `mergeConfig` from `vitest/config` to extend `vite.config.ts` or add `svgr()` and `tsconfigPaths: true` into `vitest.config.ts`.

---

#### LINT-01: Redundant throw rules in `eslint.config.js`

- **File**: [`eslint.config.js#L27,48`](file:///home/maddock/concept/eslint.config.js#L27-L48)
- **Problem**:
  `eslint.config.js` configures `@typescript-eslint/only-throw-error: 'error'` in the TypeScript block and `no-throw-literal: 'error'` in the general rules block. In `@typescript-eslint` v8+, `only-throw-error` replaces `no-throw-literal`.
- **Actionable Fix**:
  Remove `'no-throw-literal': 'error'` from line 48 of [`eslint.config.js`](file:///home/maddock/concept/eslint.config.js).

---

#### SCR-01: `preview` package script bypasses Vite build artifacts

- **File**: [`package.json#L13`](file:///home/maddock/concept/package.json#L13)
- **Problem**:
  `"preview": "pnpm run build && wrangler dev"`
  Root [`wrangler.jsonc`](file:///home/maddock/concept/wrangler.jsonc) specifies `"main": "src/worker.ts"` without static assets bindings (`"assets": { "directory": "dist/client" }` is only generated inside [`dist/server/wrangler.json`](file:///home/maddock/concept/dist/server/wrangler.json)). Running `wrangler dev` directly against root `wrangler.jsonc` may fail to serve static assets accurately compared to production.
- **Actionable Fix**:
  Change `"preview"` in [`package.json`](file:///home/maddock/concept/package.json) to:
  ```json
  "preview": "pnpm run build && wrangler dev --config dist/server/wrangler.json"
  ```
  or use `vite preview`.

---

#### DEP-01: Dependency advisory on `postcss-selector-parser`

- **File**: [`package.json#L44`](file:///home/maddock/concept/package.json#L44)
- **Problem**:
  `pnpm audit` reports a moderate vulnerability in `postcss-selector-parser` (`<7.1.6`) brought in transitively via `@tailwindcss/typography`.
- **Actionable Fix**:
  Add a pnpm override in [`package.json`](file:///home/maddock/concept/package.json):
  ```json
  "pnpm": {
    "overrides": {
      "postcss-selector-parser": ">=7.1.6"
    }
  }
  ```
  Then run `pnpm install`.

## Verified implementation outcomes

The original findings above are retained as review history. This table supersedes their severity and recommendations after checking the actual code and installed dependencies.

| Finding | Outcome                                          | Evidence and implementation                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIG-01  | Fixed latent issue (medium)                      | Better Auth internal-adapter.mjs deletes accounts before users; with-hooks.mjs cancels deleteMany when a before hook returns false. Account delete hook now defers deletion on /delete-user and /delete-user/callback to existing foreign-key cascades. Default user deletion remains disabled. Hook tests cover both paths and ordinary unlinking; SQLite tests cover Google-only and Google-plus-passkey cascades and last-method guards. No applied migration changed. |
| SEC-01  | Fixed                                            | Shared Wrangler observability now sets redact_query_string true, including inherited Preview observability.                                                                                                                                                                                                                                                                                                                                                               |
| MIG-02  | Discarded                                        | idToken clearing is intentional credential minimization, consistent with account create/update hooks; accessToken and refreshToken are unaffected. Wrangler applies pending migration files and records them in d1_migrations. Re-executing SQL manually is not the supported migration workflow. Do not rewrite applied 0004 or restore identity tokens.                                                                                                                 |
| ENV-01  | Fixed                                            | Production and staging public client IDs, copied from the corresponding Wrangler vars, are now tracked in explicitly permitted .env.production/.env.staging files. Secrets and local overrides stay ignored. Optional client ID remains valid for accountless development.                                                                                                                                                                                                |
| CFG-01  | Discarded                                        | Worker Previews use previews plus wrangler preview --worker-name concept --name staging. env.preview is a different deployment mechanism. The explicit D1 migration config correctly targets auth_db_preview rather than production.                                                                                                                                                                                                                                      |
| MIG-03  | Fixed                                            | Forward migration 0005 adds expiry indexes. Installed Better Auth filters session expiresAt and deletes expired verifications. Populated-schema test verifies retained rows/credentials, repeatable index creation, and EXPLAIN QUERY PLAN index use.                                                                                                                                                                                                                     |
| CFG-02  | Fixed stale includes; types allegation discarded | Removed ineffective JS config includes; **/*.ts already includes vite.config.ts. Committed worker-configuration.d.ts declares cloudflare:workers, Cloudflare runtime and Env; adding another workers type package would duplicate those declarations.                                                                                                                                                                                                                     |
| ENV-02  | Fixed dead configuration                         | Removed unused SERVER_URL block. Worker bindings remain typed and consumed on the server via cloudflare:workers; importing server secret validation into the shared client env module would be inappropriate. No auth requirement added to local editing.                                                                                                                                                                                                                 |
| CFG-03  | Other agent                                      | Vitest configuration intentionally untouched; owned by test-infrastructure.                                                                                                                                                                                                                                                                                                                                                                                               |
| LINT-01 | Fixed                                            | Removed base no-throw-literal rule; TypeScript only-throw-error remains enabled.                                                                                                                                                                                                                                                                                                                                                                                          |
| SCR-01  | Discarded                                        | Installed Wrangler dev passes useRedirectIfAvailable true; Vite build writes .wrangler/deploy/config.json pointing to generated dist/server/wrangler.json, which includes assets. Existing preview script already uses built artifacts.                                                                                                                                                                                                                                   |
| DEP-01  | Fixed (low build-time exposure)                  | Audit confirmed GHSA-rj75-hqrm-r3gf in typography's pinned parser 6.0.10. Scoped pnpm override selects patched 7.x; lockfile updated. Advisory says trusted build-time selectors are not affected. Audit after override has zero advisories. Source: https://github.com/advisories/GHSA-rj75-hqrm-r3gf.                                                                                                                                                                   |

Validation results and ordered commit identifiers are recorded in root codex/config-migrations.md for parent handoff. No deployment, remote migration, merge, PR, or agents were started.

Validation completed: formatting, repository lint, TypeScript no-emit, production build, 27 scoped auth/schema tests, and audit (zero advisories) passed. Full suite had 3 failing files (drive/functions hook timeout, AccountManager timeouts, DocumentMenu timeout/undefined trigger), with 250 passing tests and 4 failing tests. These files were not modified by this assignment. No remote D1 validation was performed; schema/data checks used real SQLite with foreign keys enabled.
