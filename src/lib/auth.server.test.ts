import { expect, it, vi } from 'vitest'
import { createAuth } from './auth.server'

vi.mock('better-auth', () => ({
  betterAuth: (options: unknown) => ({ options }),
}))

const bindings = {
  DB: {},
  BETTER_AUTH_SECRET: 'test-auth-secret-with-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test-google-client',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  OAUTH_PROXY_SECRET: 'test-proxy-secret-with-at-least-32-characters',
  OAUTH_PROXY_URL: 'https://concept.example',
  AUTH_TRUSTED_ORIGINS: 'https://concept.example, https://preview.example, ',
} as unknown as Cloudflare.Env

it('discards stored ID tokens while preserving encrypted provider credentials', async () => {
  const auth = createAuth(bindings, 'https://preview.example')
  const account = {
    id: 'account-id',
    accountId: 'provider-account-id',
    userId: 'user-id',
    providerId: 'google',
    createdAt: new Date(),
    updatedAt: new Date(),
    accessToken: 'encrypted-access-token',
    refreshToken: 'encrypted-refresh-token',
    idToken: 'unused-id-token',
  }
  for (const hook of [
    auth.options.databaseHooks.account.create.before,
    auth.options.databaseHooks.account.update.before,
  ]) {
    const result = await hook(account)
    expect(result.data).toEqual({ ...account, idToken: null })
  }
})
