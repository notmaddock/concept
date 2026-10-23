// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { getAuth } from './server'

const { bindings } = vi.hoisted(() => ({ bindings: {} }))
vi.mock('cloudflare:workers', () => ({ env: bindings }))

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>
let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'concept-rate-limit-'))
  platform = await getPlatformProxy<Env>({
    configPath: 'wrangler.jsonc',
    persist: { path: directory },
  })
  Object.assign(bindings, platform.env, {
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  })
  for (const filename of [
    '0001_auth.sql',
    '0002_passkeys.sql',
    '0004_storage_consent.sql',
    '0005_expiry_indexes.sql',
    '0006_auth_rate_limit.sql',
  ]) {
    const migration = await readFile(`migrations/${filename}`, 'utf8')
    // D1 exec expects one statement per line.
    await platform.env.AUTH_DB.exec(
      migration
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .split(';')
        .filter((sql) => sql.trim())
        .join(';\n') + ';',
    )
  }
}, 30_000)

afterAll(async () => {
  await platform.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
})

function request(ip: string, forwarded = '198.51.100.1') {
  return new Request('http://localhost:3000/api/auth/sign-in/social', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'cf-connecting-ip': ip,
      'x-forwarded-for': forwarded,
    },
    // Invalid provider avoids any external OAuth request, but is rate limited.
    body: JSON.stringify({ provider: 'nonexistent' }),
  })
}

it('atomically enforces the sign-in limit across auth instances on local D1', async () => {
  const instances = Array.from({ length: 8 }, () => getAuth())
  const responses = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      instances[index % instances.length].handler(
        request('203.0.113.10', `198.51.100.${index}`),
      ),
    ),
  )
  expect(responses.filter((response) => response.status === 404)).toHaveLength(
    3,
  )
  expect(responses.filter((response) => response.status === 429)).toHaveLength(
    21,
  )
  expect(
    responses
      .find((response) => response.status === 429)
      ?.headers.get('x-retry-after'),
  ).toMatch(/^\d+$/)

  // Recreating auth does not reset counters, and proxy-chain spoofing does not help.
  expect(
    (await getAuth().handler(request('203.0.113.10', '192.0.2.250'))).status,
  ).toBe(429)
  expect((await getAuth().handler(request('203.0.113.11'))).status).toBe(404)

  // Race the expired-bucket reset as well as first insert/increments above.
  await platform.env.AUTH_DB.prepare('UPDATE rateLimit SET lastRequest = ?')
    .bind(Date.now() - 60_000)
    .run()
  const reset = await Promise.all(
    instances.map((auth) => auth.handler(request('203.0.113.10'))),
  )
  expect(reset.filter((response) => response.status === 404)).toHaveLength(3)
  expect(reset.filter((response) => response.status === 429)).toHaveLength(5)
}, 30_000)
