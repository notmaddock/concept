import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assetsDir = join(process.cwd(), 'dist', 'client', 'assets')
const entryBudgetBytes = 400 * 1024
const initialBudgetBytes = 1700 * 1024

let files
try {
  files = readdirSync(assetsDir).filter((file) => file.endsWith('.js'))
} catch {
  console.error('Missing dist/client/assets. Run `pnpm run build` first.')
  process.exit(1)
}

const sizes = new Map(
  files.map((file) => [file, statSync(join(assetsDir, file)).size]),
)
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

const entry = files.find((file) => /^index-.*\.js$/.test(file))
if (!entry) {
  console.error('Could not find the initial entry chunk (assets/index-*.js).')
  process.exit(1)
}

/*
 * The entry chunk does not hold the whole initial load. TanStack Start routes
 * and their dependencies are emitted as sibling chunks that the entry
 * references through Vite's `__vite__mapDeps` table and static imports, and
 * the browser fetches them before the app renders. Sum that graph, not just
 * the entry, so a heavy dependency cannot hide in a route chunk.
 */
const entrySource = readFileSync(join(assetsDir, entry), 'utf8')
const referenced = new Set()
for (const pattern of [
  /"assets\/([^"/]+\.js)"/g,
  /from"\.\/([^"/]+\.js)"/g,
  /import\("\.\/([^"/]+\.js)"\)/g,
]) {
  for (const match of entrySource.matchAll(pattern)) {
    if (sizes.has(match[1])) referenced.add(match[1])
  }
}

const initial = [entry, ...referenced]
const initialBytes = initial.reduce((total, file) => total + sizes.get(file), 0)

console.log(`Initial entry: ${entry} — ${kib(sizes.get(entry))}`)
console.log(`Initial graph: ${initial.length} chunks — ${kib(initialBytes)}`)
console.log(
  `Budgets: entry ${kib(entryBudgetBytes)}, graph ${kib(initialBudgetBytes)}`,
)
console.log('Largest initial chunks:')
const largest = initial
  .map((name) => ({ name, bytes: sizes.get(name) }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 10)
for (const file of largest)
  console.log(`  ${kib(file.bytes).padStart(10)}  ${file.name}`)

const failures = []
if (sizes.get(entry) > entryBudgetBytes)
  failures.push(
    `Initial entry exceeds its budget by ${kib(sizes.get(entry) - entryBudgetBytes)}.`,
  )
if (initialBytes > initialBudgetBytes)
  failures.push(
    `Initial graph exceeds its budget by ${kib(initialBytes - initialBudgetBytes)}.`,
  )
if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
