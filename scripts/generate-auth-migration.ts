import { getPlatformProxy } from 'wrangler'
import { getMigrations } from 'better-auth/db/migration'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAuth } from '../src/lib/auth.server.ts'

const output = process.argv[2]
if (!output) throw new Error('Provide a new migration filename.')
const platform = await getPlatformProxy<Cloudflare.Env>({
  configPath: 'wrangler.jsonc',
})
try {
  const plan = await getMigrations(
    createAuth(platform.env, 'http://localhost:3000').options,
  )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, await plan.compileMigrations(), { flag: 'wx' })
  console.log(`Generated ${output}`)
} finally {
  await platform.dispose()
}
