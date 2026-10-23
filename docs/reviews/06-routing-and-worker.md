# Code Review & Issue Scan: Routing, Page Components, & Cloudflare Worker Backend Logic

**Target Files Reviewed:**

1. [`src/router.tsx`](file:///home/maddock/concept/src/router.tsx) & [`src/routes/__root.tsx`](file:///home/maddock/concept/src/routes/__root.tsx)
2. [`src/routes/index.tsx`](file:///home/maddock/concept/src/routes/index.tsx), [`src/routes/new/index.tsx`](file:///home/maddock/concept/src/routes/new/index.tsx), [`src/routes/d/index.tsx`](file:///home/maddock/concept/src/routes/d/index.tsx), [`src/routes/d/$id.tsx`](file:///home/maddock/concept/src/routes/d/$id.tsx)
3. [`src/routes/api/auth/$.ts`](file:///home/maddock/concept/src/routes/api/auth/$.ts) & related server functions
4. [`src/worker.ts`](file:///home/maddock/concept/src/worker.ts), [`src/lib/documents/drive/coordinator.ts`](file:///home/maddock/concept/src/lib/documents/drive/coordinator.ts), Cloudflare Worker integration, SSR/CSR, asset handling, and headers

---

## Implementation reassessment (2026-10-23)

This section supersedes the original claims and recommendations below. Previous work was copied without modifying the original worktree, all eight commits were replayed on the current parent, and the interrupted tracked patch and untracked RouteError component were preserved before reassessment.

| Finding                              | Outcome                | Evidence and final behavior                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Devtools                           | CONFIRMED NOT AN ISSUE | `vite.config.ts` enables `devtools()`; installed `@tanstack/devtools-vite/dist/esm/plugin.js` defaults `removeDevtoolsOnBuild` to true and strips imports/JSX during build. Current build logs explicitly say “Removed devtools code from: /src/routes/__root.tsx”.                                                                                                                                                                                     |
| 2 Creation history                   | FIXED                  | `useDocuments.createDocument` accepts optional replace; `NewDocument` supplies it for initial creation and retry. Other creation actions retain push. `NewDocument.test.tsx` verifies the option; hook navigation preserves parent integrations.                                                                                                                                                                                                        |
| 3 Worker headers/cache               | FIXED                  | Worker adds nosniff, frame denial, referrer policy, host-only HSTS and permissions policy; HTML defaults to private/no-store while explicit cache policy and multiple cookies survive. `public/_headers` sets immutable caching only for hashed `/assets/*`. `worker.test.ts` covers response handling. No wildcard CORS is needed for the same-origin app. A complete CSP requires application-specific script/style policy and was not blindly added. |
| 4 Document route validation/soft 404 | CONFIRMED NOT AN ISSUE | IndexedDB availability cannot be determined by SSR. `DocumentWorkspace` performs local lookup and renders the missing-on-device state. `importConcept(..., target)` accepts target IDs and Drive metadata reads nonempty `conceptId`; UUID-only route validation would reject such cached IDs. Restored opaque IDs with no server auth prerequisite. Unknown local IDs intentionally receive an app shell before browser lookup.                        |
| 5 Auth OPTIONS/CORS                  | CONFIRMED NOT AN ISSUE | `authClient` has no cross-origin baseURL, and `/api/auth/$` GET/POST forward to the local Better Auth handler. Staging hosts run their own same-origin app. There is no configured external auth client or cross-origin API contract. Removed speculative OPTIONS forwarding; adding a handler alone would not establish safe CORS.                                                                                                                     |
| 6 Coordinator statuses               | FIXED                  | Typed `DriveError` preserves upstream 401/403/404/412/other failures through coordinator and `saveDriveDocument`; unexpected failures remain 500. Tests exercise coordinator 412 and client-facing 403. Existing client sync still primarily displays messages; this change does not claim a new automatic status-based reconnect flow.                                                                                                                 |
| 7 Home action                        | FIXED                  | Home “New document” links directly to `/new`; route test covers target.                                                                                                                                                                                                                                                                                                                                                                                 |
| 8 SEO                                | FIXED                  | Generic description, Open Graph/Twitter metadata and library/creation titles added. Private browser document titles remain client-owned; server does not load local/private contents for crawlers. No invented public document URL or image. Root test covers metadata.                                                                                                                                                                                 |
| 9 Pagination                         | FIXED                  | Ten-page request budget stops runaway pagination, and a continuation token at the budget throws explicit 503 explaining that no partial library was returned. Test verifies rejection after ten requests; ordinary multipage completion remains tested. Large remote libraries need a future continuation UI; current behavior reports failure rather than silently hiding documents. Local document storage is unaffected.                             |
| 10 Preload stale time                | CONFIRMED NOT AN ISSUE | Current routes contain no loader/beforeLoad data fetches. Setting data freshness to zero does not imply route modules are redownloaded on every hover. No redundant network operation was demonstrated; retained original policy rather than speculatively changing freshness.                                                                                                                                                                          |
| 11 Home viewport                     | FIXED                  | Home uses normal flow with min-h-svh and padding instead of fixed inset-0, allowing vertical overflow to scroll.                                                                                                                                                                                                                                                                                                                                        |
| 12 Bearer parsing                    | FIXED                  | Coordinator requires case-insensitive Bearer scheme and trims whitespace; invalid/missing tokens return 401. Tests cover Basic rejection and lowercase/multiple-space Bearer. Original slice already handled lowercase scheme incidentally, but did not validate scheme.                                                                                                                                                                                |
| 13 Error fallback                    | FIXED                  | Router and root use `RouteError` with generic user-facing text, retry reset/invalidate and home link. Test ensures raw internal error is absent and retry invokes recovery. Removed unsupported promise that all local documents must be safe after an arbitrary crash.                                                                                                                                                                                 |

Validation results are recorded at the end of this report. New working notes/logs live only in ignored `codex/`; this existing report remains an authorized ignored local artifact for parent copy.

---

## Executive Summary

| Severity     | Count | Primary Areas Impacted                                                                                                                                                                                           |
| :----------- | :---: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** |   2   | Production Bundle & Security Exposure (`TanStackDevtools` in prod), History Navigation Loop (`/new` push instead of replace)                                                                                     |
| **High**     |   4   | Missing Security & Cache Headers in Cloudflare Worker, Soft-404 / Missing Route Validation on `/d/$id`, Broken CORS / `OPTIONS` Preflights on `/api/auth/$`, Durable Object Error Flattening (500 on all errors) |
| **Medium**   |   4   | Incorrect Target Route on Home Page ("New document" button links to `/d`), SSR SEO / Dynamic Title Omission, Unbounded Drive Pagination Loop, Aggressive Preload Stale Time (0ms)                                |
| **Low**      |   3   | Viewport Layout Constraint on Mobile (`fixed inset-0`), Fragile Bearer Token Parsing in Durable Object, Missing Fallback Error Boundary in Router                                                                |

---

## Critical Severity

### 1. `TanStackDevtools` Bundled & Rendered Unconditionally in Production

- **File:** [`src/routes/__root.tsx#L9-L10`](file:///home/maddock/concept/src/routes/__root.tsx#L9-L10) and [`src/routes/__root.tsx#L70-L81`](file:///home/maddock/concept/src/routes/__root.tsx#L70-L81)
- **Description:** `TanStackDevtools` and `TanStackRouterDevtoolsPanel` are statically imported and mounted directly inside `RootDocument`. Because they are not guarded by `import.meta.env.DEV`, the entire router devtools suite is compiled into the client production bundle. In production, this renders a floating devtools trigger widget for every user, exposing all internal routing state, loader parameters, router context, and significantly inflating client bundle size.
- **Impact:** Information disclosure of router state/internals, UI pollution on production, unnecessary bundle weight (~100+ kB).
- **Actionable Fix:** Conditionally load or render the devtools only during development:

```tsx
// src/routes/__root.tsx
import { lazy, Suspense } from 'react'

const TanStackDevtools = import.meta.env.DEV
  ? lazy(() =>
      Promise.all([
        import('@tanstack/react-devtools'),
        import('@tanstack/react-router-devtools'),
      ]).then(([devtools, routerDevtools]) => ({
        default: () => (
          <devtools.TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <routerDevtools.TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ),
      })),
    )
  : () => null

// Inside RootDocument:
<Suspense fallback={null}>
  <TanStackDevtools />
</Suspense>
```

---

### 2. History Navigation Loop on `/new` (Infinite Back-Button Trap)

- **File:** [`src/routes/new/index.tsx#L4-L6`](file:///home/maddock/concept/src/routes/new/index.tsx#L4-L6) & [`src/hooks/use-documents.ts#L114`](file:///home/maddock/concept/src/hooks/use-documents.ts#L114)
- **Description:** Navigating to `/new` mounts [`NewDocument`](file:///home/maddock/concept/src/components/documents/NewDocument.tsx), which runs `useEffect` to invoke `createDocument()`. In `createDocument()`, `navigate({ to: '/d/$id', params: { id: created.id } })` performs a standard history **push** (`replace: false`). When a user on `/d/$id` clicks the browser's "Back" button, the browser navigates back to `/new`. `NewDocument` remounts, triggers `useEffect`, creates an entirely new document, and pushes forward to `/d/<new-id>`. The user is permanently trapped and cannot navigate back past `/new`.
- **Impact:** Broken browser back-button behavior; creates zombie documents in IndexedDB whenever users attempt to go back.
- **Actionable Fix:** Use `replace: true` when redirecting from action/creation routes:

```tsx
// src/hooks/use-documents.ts line 114
await navigate({
  to: '/d/$id',
  params: { id: created.id },
  replace: true,
})
```

---

## High Severity

### 3. Missing Security Headers, CORS, and Cache-Control in Cloudflare Worker

- **File:** [`src/worker.ts#L1-L2`](file:///home/maddock/concept/src/worker.ts#L1-L2)
- **Description:** `src/worker.ts` directly re-exports `@tanstack/react-start/server-entry` as the default export without intercepting requests or responses. Consequently:
  1. **No Security Headers:** Responses lack `Content-Security-Policy`, `X-Frame-Options` (or `frame-ancestors`), `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, and `Referrer-Policy`. (Note: `__root.tsx` only sets `referrer` in DEV mode, leaving production with no referrer policy). An authenticated document editor app storing Google Drive OAuth credentials is susceptible to iframe embedding / clickjacking.
  2. **No Cache Control for SSR:** Dynamic SSR HTML is emitted without explicit `Cache-Control: private, no-cache, no-store, must-revalidate`, risking CDN edge-caching of authenticated or dynamic state.
  3. **No Immutable Caching for Static Assets:** Cloudflare Worker Static Assets (`"assets": { "directory": "../client" }`) serves assets from `public/` and `assets/`. Without a `public/_headers` file, hashed chunks in `/assets/` are served without `Cache-Control: public, max-age=31536000, immutable`.
- **Actionable Fix:**
  1. Create [`public/_headers`](file:///home/maddock/concept/public/_headers):
  ```http
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  2. Wrap the default export in [`src/worker.ts`](file:///home/maddock/concept/src/worker.ts) to attach security and response headers:
  ```ts
  import serverEntry from '@tanstack/react-start/server-entry'
  export { DriveSaveCoordinator } from './lib/documents/drive/coordinator'

  export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const response = await serverEntry.fetch(request, env, ctx)
      const headers = new Headers(response.headers)

      // Security headers
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('X-Frame-Options', 'DENY')
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      )
      headers.set(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      )

      // Ensure SSR HTML is not cached publicly
      const contentType = headers.get('content-type') || ''
      if (contentType.includes('text/html')) {
        headers.set(
          'Cache-Control',
          'private, no-cache, no-store, must-revalidate',
        )
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    },
  }
  ```

---

### 4. Soft-404 and Missing Validation on Route `/d/$id`

- **File:** [`src/routes/d/$id.tsx#L4-L9`](file:///home/maddock/concept/src/routes/d/$id.tsx#L4-L9)
- **Description:** The route definition contains no parameter parsing/validation (`params.parse`) and no route loader:
  1. If a client visits `/d/not-a-valid-uuid` or any nonexistent document ID, the Cloudflare Worker SSR streams an **HTTP 200 OK** response rendering `<DocumentLoading />`.
  2. Once hydrated on the client, `useDocuments` fails to find the document in local IndexedDB and renders an inline fallback div (`<h2>Document not found</h2>`). TanStack Router's `notFoundComponent` is never invoked, and search engine crawlers/social scrapers receive HTTP 200 instead of HTTP 404.
  3. No format validation prevents invalid UUIDs or malicious path segments from propagating into IndexedDB calls.
- **Actionable Fix:** Add param validation using Zod and throw `notFound()` in `loader` or `beforeLoad`:

```tsx
// src/routes/d/$id.tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export const Route = createFileRoute('/d/$id')({
  params: {
    parse: (params) => paramsSchema.parse(params),
    stringify: ({ id }) => ({ id }),
  },
  component: DocumentRoute,
})

function DocumentRoute() {
  const { id } = Route.useParams()
  return <DocumentWorkspace id={id} />
}
```

---

### 5. Missing `OPTIONS` Handler on `/api/auth/$` Breaks CORS Preflight Requests

- **File:** [`src/routes/api/auth/$.ts#L9-L11`](file:///home/maddock/concept/src/routes/api/auth/$.ts#L9-L11)
- **Description:**
  ```ts
  export const Route = createFileRoute('/api/auth/$')({
    server: { handlers: { GET: handle, POST: handle } },
  })
  ```
  `server.handlers` registers only `GET` and `POST`. Better Auth supports and expects `OPTIONS` requests for cross-origin preflight checks (e.g. from preview domains, staging subdomains, or external auth clients). When an `OPTIONS` request is received, TanStack Router responds with `405 Method Not Allowed`, failing the preflight before Better Auth can evaluate CORS headers.
- **Actionable Fix:** Register the `OPTIONS` handler:

```ts
// src/routes/api/auth/$.ts
export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handle, POST: handle, OPTIONS: handle } },
})
```

---

### 6. Durable Object `DriveSaveCoordinator` Flattens All Failures to HTTP 500

- **File:** [`src/lib/documents/drive/coordinator.ts#L22-L30`](file:///home/maddock/concept/src/lib/documents/drive/coordinator.ts#L22-L30)
- **Description:**
  ```ts
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Drive save failed.',
      },
      { status: 500 },
    )
  }
  ```
  In [`src/lib/documents/drive/server.ts#L43-L52`](file:///home/maddock/concept/src/lib/documents/drive/server.ts#L43-L52), `request()` throws specific errors for HTTP 401/403 (Google Drive access revoked/expired), 412 (concurrency conflict during save), and 404 (file missing). However, `DriveSaveCoordinator` catches all errors and returns a flat `status: 500`.
- **Impact:** Client synchronization logic cannot distinguish between a transient 500 server error, an expired OAuth token (401), or a concurrent edit conflict (412). As a result, automatic retry and reconnect flows fail to trigger.
- **Actionable Fix:** Preserve status codes or attach a status code property to thrown errors:

```ts
// src/lib/documents/drive/coordinator.ts
} catch (error) {
  const status = error instanceof HttpError ? error.status : 500
  return Response.json(
    { error: error instanceof Error ? error.message : 'Drive save failed.' },
    { status },
  )
}
```

---

## Medium Severity

### 7. Incorrect Navigation Target on Home Page "New document" Button

- **File:** [`src/routes/index.tsx#L16`](file:///home/maddock/concept/src/routes/index.tsx#L16)
- **Description:**
  ```tsx
  <Button nativeButton={false} render={<Link to="/d" />} size={'lg'}>
    <PlusIcon /> New document
  </Button>
  ```
  The button displays a `PlusIcon` and the text "New document", but links to `/d` (the empty library workspace). When clicked, the user is taken to `/d`, which shows the library placeholder and forces the user to click "New document" a second time.
- **Actionable Fix:** Link to `/new` to create a document immediately, matching the behavior in [`src/components/not-found.tsx#L27-L32`](file:///home/maddock/concept/src/components/not-found.tsx#L27-L32):

```tsx
// src/routes/index.tsx
<Button nativeButton={false} render={<Link to="/new" />} size={'lg'}>
  <PlusIcon /> New document
</Button>
```

---

### 8. Missing Route-Level SEO Meta Tags & SSR Title Sync

- **File:** [`src/routes/__root.tsx#L21-L49`](file:///home/maddock/concept/src/routes/__root.tsx#L21-L49) and [`src/components/documents/document-workspace-context.tsx#L53-L60`](file:///home/maddock/concept/src/components/documents/document-workspace-context.tsx#L53-L60)
- **Description:**
  1. `__root.tsx` defines static meta: `{ title: 'Concept' }`, with no `<meta name="description">`, Open Graph tags (`og:title`, `og:description`, `og:url`, `og:image`), or Twitter card metadata.
  2. Individual routes (`/`, `/d`, `/d/$id`, `/new`) do not define `head` functions.
  3. In `document-workspace-context.tsx`, document titles are updated via `window.document.title = ...` in a client `useEffect`. Consequently, SSR HTML streamed to social platforms and search engines always renders `<title>Concept</title>` without document-specific metadata.
- **Actionable Fix:** Add standard SEO metadata in `src/routes/__root.tsx` and configure per-route `head` definitions where appropriate.

---

### 9. Unbounded Google Drive Pagination Loop Can Exhaust Worker Limits

- **File:** [`src/lib/documents/drive/server.ts#L92-L113`](file:///home/maddock/concept/src/lib/documents/drive/server.ts#L92-L113)
- **Description:**
  ```ts
  do {
    const params = new URLSearchParams(...)
    const response = await request(accessToken, `${api}?${params}`)
    ...
    pageToken = page.nextPageToken
  } while (pageToken)
  ```
  `listDriveDocuments` pages through Google Drive files using an unbounded `do ... while (pageToken)` loop. In Cloudflare Workers, workers are subject to subrequest limits (50 subrequests on free plans) and wall-clock execution limits. If an account contains many files or pages, this loop will exhaust subrequest limits and throw an unhandled `Too many subrequests` exception.
- **Actionable Fix:** Introduce a maximum page count guard (e.g. `maxPages = 5`) or paginate results on demand.

---

### 10. Aggressive Route Preload Invalidation (`defaultPreloadStaleTime: 0`)

- **File:** [`src/router.tsx#L10`](file:///home/maddock/concept/src/router.tsx#L10)
- **Description:**
  ```ts
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  ```
  With `defaultPreload: 'intent'` and `defaultPreloadStaleTime: 0`, any hover over a `<Link>` immediately marks preloaded route modules and data as stale. Moving the mouse across links repeatedly triggers redundant preload requests.
- **Actionable Fix:** Increase `defaultPreloadStaleTime` to a reasonable caching window (e.g., `30_000` ms):

```ts
// src/router.tsx
defaultPreload: 'intent',
defaultPreloadStaleTime: 30_000,
```

---

## Low Severity

### 11. Viewport Layout Constraint on Mobile (`fixed inset-0`)

- **File:** [`src/routes/index.tsx#L10`](file:///home/maddock/concept/src/routes/index.tsx#L10)
- **Description:** `<main className="fixed inset-0 flex flex-col gap-4 justify-center items-center">` locks the home page to viewport dimensions. On small mobile devices or landscape viewports with low height, the content overflows without vertical scroll capability.
- **Actionable Fix:** Use `min-h-svh w-full` instead of `fixed inset-0`:

```tsx
<main className="flex min-h-svh w-full flex-col items-center justify-center gap-4 p-4">
```

---

### 12. Fragile Bearer Token Parsing in Durable Object

- **File:** [`src/lib/documents/drive/coordinator.ts#L18`](file:///home/maddock/concept/src/lib/documents/drive/coordinator.ts#L18)
- **Description:** `request.headers.get('Authorization')?.slice(7)` assumes exact casing and spacing (`"Bearer "`). If a client or proxy normalizes the header to `"bearer <token>"` or uses multiple spaces, `slice(7)` produces an invalid token or slice index mismatch.
- **Actionable Fix:** Parse with a case-insensitive regex:

```ts
const authHeader = request.headers.get('Authorization')
const accessToken = authHeader?.replace(/^Bearer\s+/i, '').trim()
```

---

### 13. Missing Fallback Error Boundary in Router

- **File:** [`src/router.tsx#L7-L13`](file:///home/maddock/concept/src/router.tsx#L7-L13) and [`src/routes/__root.tsx#L45`](file:///home/maddock/concept/src/routes/__root.tsx#L45)
- **Description:** `getRouter()` specifies `defaultNotFoundComponent: NotFound`, but does not configure `defaultErrorComponent`. In `__root.tsx`, `errorComponent: ErrorComponent` directly uses the default TanStack Router error component, which renders raw error objects and stacks to end users upon unhandled render crashes.
- **Actionable Fix:** Provide a user-facing error fallback component with a "Try again" action and home navigation.

---

## Verification & Status Check

- **Tests Execution:** Vitest ran 39 test suites (234 passing). The 4 test failures identified in `src/components/documents/*.test.tsx` were due to mock import paths importing `localDocumentStorage` from `#/lib/documents/storage` instead of `#/lib/documents/storages/local`.
- **Build Validation:** Production bundle builds successfully with `vite build`. Cloudflare Worker asset compilation outputs to `dist/server` and `dist/client`.

## Final fallback validation

- `pnpm run lint`: PASS, zero warnings.
- `pnpm run typecheck`: PASS after adapting creation button callbacks and awaiting route head results.
- `pnpm run check`: PASS.
- `pnpm run build`: PASS; devtools removal logged and generated client/router JavaScript contains no TanStackDevtools/TanStackRouterDevtoolsPanel identifiers. Build emits existing route-test discovery and sourcemap warnings.
- Final focused regression command (Worker, root/home routes, NewDocument, Drive server, useDocuments; two workers, testTimeout 30s/hookTimeout 60s): 6 files / 38 tests PASS.
- Full default-timeout suite: 39 files pass, 3 fail on timeouts; 257 tests pass, 2 timeout, 4 skipped after large-document beforeAll timeout. Two-worker retry also encountered timeouts under host load around 39. No assertion mismatch was reported.
- Isolated retry of all timeout-prone files (`DocumentList`, `DocumentStorageDialog`, `AccountManager`, Drive functions) with one worker and CLI testTimeout 30s/hookTimeout 60s: 4 files / 28 tests PASS. Repository timeout settings unchanged.
- `git diff --check`: PASS. Tracked working tree clean.

Final outcomes: FIXED 2, 3, 6, 7, 8, 9, 11, 12, 13; CONFIRMED NOT AN ISSUE 1, 4, 5, 10; none BLOCKED.

Residual limits: oversized Drive libraries receive an explicit error until continuation UI is implemented; no claim of deploy-time header verification or complete CSP. The full suite has not passed as a single run at default timeouts on this loaded host. Existing local/private document opening remains browser-owned, accountless and provider-independent.
