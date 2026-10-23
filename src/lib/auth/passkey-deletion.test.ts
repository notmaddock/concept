// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { passkey } from '@better-auth/passkey'
import { createAuthMiddleware, freshSessionMiddleware } from 'better-auth/api'
import { makeSignature } from 'better-auth/crypto'

describe('passkey deletion session freshness', () => {
  let database: DatabaseSync
  const secret = 'test-secret-at-least-thirty-two-characters'
  const baseURL = 'http://localhost:3000'

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON')
    for (const migration of [
      '0001_auth.sql',
      '0002_passkeys.sql',
      '0003_sign_in_guards.sql',
      '0004_storage_consent.sql',
    ]) {
      database.exec(
        readFileSync(
          new URL(`../../../migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      )
    }
  })

  afterEach(() => {
    database.close()
  })

  it('rejects stale sessions on /passkey/delete-passkey and allows fresh sessions', async () => {
    const auth = betterAuth({
      database,
      secret,
      baseURL,
      session: { freshAge: 300 }, // 5 minutes
      plugins: [
        passkey({
          rpName: 'Concept',
          origin: baseURL,
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'preferred',
          },
        }),
      ],
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          if (ctx.path === '/passkey/delete-passkey') {
            await freshSessionMiddleware(ctx)
          }
        }),
      },
    })

    const ctx = await auth.$context
    const user = await ctx.internalAdapter.createUser({
      name: 'Example User',
      email: 'user@example.com',
      emailVerified: true,
    })
    const session = await ctx.internalAdapter.createSession(user.id)
    const signature = await makeSignature(session.token, secret)
    const cookieName = ctx.authCookies.sessionToken.name
    const cookieHeader = `${cookieName}=${session.token}.${signature}`

    // Insert Google account and passkey
    const now = Date.now()
    database.exec(`
      INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
      VALUES ('acc-1', 'sub-1', 'google', '${user.id}', 0, 0);
      INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
      VALUES ('key-1', 'Security Key', 'public-key', '${user.id}', 'cred-1', 0, 'singleDevice', 0, 0);
    `)

    // Age session so it is stale (> 5 minutes)
    database
      .prepare('UPDATE session SET createdAt = ? WHERE id = ?')
      .run(now - 600_000, session.id)

    // Attempt delete with stale session
    const staleReq = new Request(`${baseURL}/api/auth/passkey/delete-passkey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseURL,
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ id: 'key-1' }),
    })

    const staleRes = await auth.handler(staleReq)
    expect(staleRes.status).toBe(403)
    const staleBody = (await staleRes.json()) as { code: string }
    expect(staleBody.code).toBe('SESSION_NOT_FRESH')

    // Verify credential was NOT deleted
    const passkeyAfterStale = database
      .prepare('SELECT id FROM passkey WHERE id = ?')
      .get('key-1')
    expect(passkeyAfterStale).toBeDefined()

    // Refresh session createdAt to current time (< 5 minutes)
    database
      .prepare('UPDATE session SET createdAt = ? WHERE id = ?')
      .run(Date.now(), session.id)

    // Attempt delete with fresh session
    const freshReq = new Request(`${baseURL}/api/auth/passkey/delete-passkey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseURL,
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ id: 'key-1' }),
    })

    const freshRes = await auth.handler(freshReq)
    expect(freshRes.status).toBe(200)
    const freshBody = (await freshRes.json()) as { status: boolean }
    expect(freshBody.status).toBe(true)

    // Verify credential was deleted
    const passkeyAfterFresh = database
      .prepare('SELECT id FROM passkey WHERE id = ?')
      .get('key-1')
    expect(passkeyAfterFresh).toBeUndefined()
  })
})
