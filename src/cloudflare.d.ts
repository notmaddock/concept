import type { D1Database as WorkerD1Database } from '@cloudflare/workers-types'

// Scope Workers types so they do not replace the browser's DOM types.
declare global {
  type D1Database = WorkerD1Database
}
