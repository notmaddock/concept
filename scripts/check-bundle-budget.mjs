import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assetsDir = join(process.cwd(), 'dist', 'client', 'assets')
const entryBudgetBytes = 400 * 1024

let files
try {
  files = readdirSync(assetsDir).filter((file) => file.endsWith('.js'))
} catch {
  console.error('Missing dist/client/assets. Run `pnpm run build` first.')
  process.exit(1)
}

const chunks = files
  .map((file) => ({
    file,
    bytes: statSync(join(assetsDir, file)).size,
  }))
  .sort((a, b) => b.bytes - a.bytes)

const entry = chunks.find((chunk) => /^index-.*\.js$/.test(chunk.file))
if (!entry) {
  console.error('Could not find the initial entry chunk (assets/index-*.js).')
  process.exit(1)
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

console.log(`Initial entry: ${entry.file} — ${kib(entry.bytes)}`)
console.log(`Budget: ${kib(entryBudgetBytes)}`)
console.log('Largest JS chunks:')
for (const chunk of chunks.slice(0, 10))
  console.log(`  ${kib(chunk.bytes).padStart(10)}  ${chunk.file}`)

if (entry.bytes > entryBudgetBytes) {
  console.error(
    `Initial entry exceeds the budget by ${kib(entry.bytes - entryBudgetBytes)}.`,
  )
  process.exit(1)
}
