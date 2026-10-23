// @vitest-environment node
import type * as BetterAuthApi from 'better-auth/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAuth,
  getProviderAccessToken,
  disconnectStorageCredentials,
} from './server'

const { api, options, database, oauth } = vi.hoisted(() => {
  const capturedOptions: { current: Record<string, unknown> } = { current: {} }
  return {
    oauth: { getState: vi.fn(), addContext: vi.fn(), getSession: vi.fn() },
    api: {
      getSession: vi.fn(),
      listUserAccounts: vi.fn(),
      getAccessToken: vi.fn(),
    },
    options: capturedOptions,
    database: { prepare: vi.fn(), bind: vi.fn(), run: vi.fn() },
  }
})
vi.mock('cloudflare:workers', () => ({
  env: {
    AUTH_DB: database,
    BETTER_AUTH_URL: 'http://localhost:3001',
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  },
}))
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthApi>()),
  createAuthMiddleware: (handler: unknown) => handler,
  getOAuthState: oauth.getState,
  addOAuthServerContext: oauth.addContext,
  getSessionFromCtx: oauth.getSession,
}))
vi.mock('better-auth', () => ({
  betterAuth: vi.fn((config) => {
    options.current = config
    return { api }
  }),
}))

const headers = new Headers()
const driveScope = 'https://www.googleapis.com/auth/drive.file'
const driveScopes = [
  driveScope,
  'https://www.googleapis.com/auth/drive.install',
]

beforeEach(() => {
  vi.resetAllMocks()
  database.prepare.mockReturnValue(database)
  database.bind.mockReturnValue(database)
  database.run.mockResolvedValue({ success: true })
  api.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  oauth.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  api.listUserAccounts.mockResolvedValue([
    { id: 'owned-account', scopes: [driveScope], driveConnected: true },
  ])
  api.getAccessToken.mockResolvedValue({ accessToken: 'server-only-token' })
})

describe('storage authorization', () => {
  it('encrypts tokens and keeps storage scopes out of sign-in', () => {
    getAuth()
    expect(options.current.plugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'one-tap' })]),
    )
    expect(options.current.disabledPaths).toEqual([
      '/get-access-token',
      '/refresh-token',
      '/account-info',
    ])
    expect(options.current.account).toMatchObject({
      encryptOAuthTokens: true,
      updateAccountOnSignIn: false,
    })
    expect(options.current.socialProviders).toMatchObject({
      google: { accessType: 'offline' },
    })
    expect(options.current.socialProviders).not.toHaveProperty('google.scope')
  })

  it('rejects anonymous requests before looking up accounts', async () => {
    api.getSession.mockResolvedValue(null)
    await expect(
      getProviderAccessToken(headers, 'owned-account', [driveScope]),
    ).rejects.toThrow('Sign in')
    expect(api.listUserAccounts).not.toHaveBeenCalled()
    expect(api.getAccessToken).not.toHaveBeenCalled()
  })

  it('rejects another user’s account', async () => {
    await expect(
      getProviderAccessToken(headers, 'other-account', [driveScope]),
    ).rejects.toThrow('Connection not found')
    expect(api.getAccessToken).not.toHaveBeenCalled()
  })

  it('requires every permission, including after partial consent', async () => {
    await expect(
      getProviderAccessToken(headers, 'owned-account', [driveScope, 'missing']),
    ).rejects.toThrow('Additional permissions')
    expect(api.getAccessToken).not.toHaveBeenCalled()
  })

  it('uses Better Auth token refresh for the selected owned account', async () => {
    await expect(
      getProviderAccessToken(headers, 'owned-account', [driveScope]),
    ).resolves.toEqual({ accessToken: 'server-only-token' })
    expect(api.getAccessToken).toHaveBeenCalledWith({
      headers,
      body: { accountId: 'owned-account' },
    })
  })

  it('requires reconnect when refresh credentials are revoked', async () => {
    api.getAccessToken.mockRejectedValue(new Error('invalid_grant'))
    await expect(
      getProviderAccessToken(headers, 'owned-account', [driveScope]),
    ).rejects.toThrow('Reconnect')
  })
})

describe('disconnecting storage', () => {
  it('rejects anonymous requests without touching stored credentials', async () => {
    api.getSession.mockResolvedValue(null)
    await expect(
      disconnectStorageCredentials(headers, 'owned-account'),
    ).rejects.toThrow('Sign in')
    expect(database.prepare).not.toHaveBeenCalled()
  })

  it('deletes credentials only for an account owned by the session user', async () => {
    await disconnectStorageCredentials(headers, 'owned-account')
    expect(database.prepare).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = ? AND userId = ?'),
    )
    expect(database.prepare).toHaveBeenCalledWith(
      expect.stringContaining('refreshToken = NULL'),
    )
    expect(database.bind).toHaveBeenCalledWith(
      expect.any(Number),
      'owned-account',
      'user-1',
    )
    expect(database.run).toHaveBeenCalledOnce()
  })
})

describe('persisted credentials', () => {
  it.each(['create', 'update'] as const)(
    'discards unused Google ID tokens on account %s',
    async (operation) => {
      getAuth()
      const config = options.current as unknown as {
        databaseHooks: {
          account: Record<
            'create' | 'update',
            {
              before: (account: {
                idToken: string
                accessToken: string
              }) => Promise<{ data: { idToken: null; accessToken: string } }>
            }
          >
        }
      }
      const result = await config.databaseHooks.account[operation].before({
        idToken: 'replayable-google-id-token',
        accessToken: 'encrypted-access-token',
      })
      expect(result.data).toEqual({
        idToken: null,
        accessToken: 'encrypted-access-token',
      })
    },
  )

  it('defers account deletion during user deletion to ON DELETE CASCADE while preserving unlink checks', async () => {
    getAuth()
    const config = options.current as unknown as {
      databaseHooks: {
        account: {
          delete: {
            before: (
              account: { id: string },
              ctx?: { path?: string } | null,
            ) => Promise<boolean | undefined>
          }
        }
      }
    }
    const beforeDelete = config.databaseHooks.account.delete.before
    await expect(
      beforeDelete({ id: 'owned-account' }, { path: '/delete-user' }),
    ).resolves.toBe(false)
    await expect(
      beforeDelete({ id: 'owned-account' }, { path: '/delete-user/callback' }),
    ).resolves.toBe(false)
    await expect(
      beforeDelete({ id: 'owned-account' }, { path: '/unlink-account' }),
    ).resolves.toBeUndefined()
  })
})

describe('explicit storage consent', () => {
  function hooks() {
    getAuth()
    return options.current as unknown as {
      hooks: {
        before: (ctx: {
          path: string
          body: Record<string, unknown>
        }) => Promise<void>
      }
      databaseHooks: {
        account: {
          create: { after: (value: typeof account) => Promise<void> }
          update: { after: (value: typeof account) => Promise<void> }
        }
      }
    }
  }
  const account = {
    id: 'owned-account',
    userId: 'user-1',
    providerId: 'google',
    scope: driveScope,
  }

  it('records only explicitly requested authenticated Drive linking in trusted state', async () => {
    const { before } = hooks().hooks
    await before({
      path: '/link-social',
      body: {
        provider: 'google',
        scopes: [],
        additionalData: { serverContext: { driveConsentUserId: 'user-1' } },
        serverContext: { driveConsentUserId: 'user-1' },
      },
    })
    await before({
      path: '/link-social',
      body: { provider: 'google', scopes: [driveScope] },
    })
    await before({
      path: '/sign-in/social',
      body: { provider: 'google', scopes: driveScopes },
    })
    expect(oauth.addContext).not.toHaveBeenCalled()
    await before({
      path: '/link-social',
      body: { provider: 'google', scopes: driveScopes },
    })
    expect(oauth.addContext).toHaveBeenCalledWith({
      driveConsentUserId: 'user-1',
    })
  })

  it.each(['create', 'update'] as const)(
    'does not restore consent on authentication-only %s with previous Google grants or spoofed client state',
    async (operation) => {
      oauth.getState.mockResolvedValue({
        link: { userId: 'user-1' },
        driveConsentUserId: 'user-1',
      })
      await hooks().databaseHooks.account[operation].after(account)
      expect(database.prepare).not.toHaveBeenCalled()
      api.listUserAccounts.mockResolvedValue([
        { ...account, scopes: [driveScope], driveConnected: false },
      ])
      await expect(
        getProviderAccessToken(headers, account.id, [driveScope]),
      ).rejects.toThrow('Connect storage')
      expect(api.getAccessToken).not.toHaveBeenCalled()
    },
  )

  async function exchangeScopes(scopes?: Array<string>) {
    const config = options.current as unknown as {
      socialProviders: {
        google: {
          getUserInfo: (tokens: {
            idToken: string
            scopes?: Array<string>
          }) => Promise<unknown>
        }
      }
    }
    const idToken = `e30.${btoa(JSON.stringify({ sub: 'subject', name: 'Example', email: 'example@example.com', email_verified: true }))}.signature`
    await config.socialProviders.google.getUserInfo({ idToken, scopes })
  }

  it.each(['create', 'update'] as const)(
    'persists consent on explicit %s only for the OAuth-linked owner and actual token grants',
    async (operation) => {
      oauth.getState.mockResolvedValue({
        link: { userId: 'user-1' },
        serverContext: { driveConsentUserId: 'user-1' },
      })
      const after = hooks().databaseHooks.account[operation].after
      await after(account)
      expect(database.prepare).not.toHaveBeenCalled()
      await exchangeScopes(driveScopes)
      await after({ ...account, userId: 'other-user' })
      expect(database.prepare).not.toHaveBeenCalled()
      await after(account)
      expect(database.prepare).toHaveBeenCalledWith(
        'UPDATE account SET driveConnected = ?, scope = ? WHERE id = ? AND userId = ?',
      )
      expect(database.bind).toHaveBeenCalledWith(
        1,
        driveScopes.join(','),
        'owned-account',
        'user-1',
      )
    },
  )

  it.each([
    { scopes: [driveScope] },
    { scopes: ['https://www.googleapis.com/auth/drive.install'] },
    { scopes: ['openid', 'email'] },
    { scopes: undefined },
  ])(
    'clears consent and stale merged scopes after a partial or absent token scope response: $scopes',
    async ({ scopes }) => {
      oauth.getState.mockResolvedValue({
        link: { userId: 'user-1' },
        serverContext: { driveConsentUserId: 'user-1' },
      })
      const after = hooks().databaseHooks.account.update.after
      await exchangeScopes(scopes)
      await after(account)
      expect(database.bind).toHaveBeenCalledWith(
        0,
        scopes?.join(',') ?? '',
        'owned-account',
        'user-1',
      )
    },
  )

  it('uses Cloudflare client IP rather than attacker-supplied proxy chains', () => {
    getAuth()
    expect(options.current.advanced).toEqual({
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    })
  })
})

describe('passkey configuration', () => {
  it('requires discoverable credentials (residentKey: required) for username-less sign-in', () => {
    getAuth()
    const plugins = options.current.plugins as Array<{
      id: string
      options?: {
        authenticatorSelection?: { residentKey?: string; userVerification?: string }
      }
    }>
    const passkeyPlugin = plugins?.find((plugin) => plugin.id === 'passkey')
    expect(passkeyPlugin).toBeDefined()
    expect(passkeyPlugin?.options?.authenticatorSelection).toEqual({
      residentKey: 'required',
      userVerification: 'preferred',
    })
  })
})
