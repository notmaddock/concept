import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { google } from 'better-auth/social-providers'
import { oneTap } from 'better-auth/plugins'
import {
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from 'better-auth/api'
import { googlePermissions, hasScopes } from './connections'
import { passkey } from '@better-auth/passkey'

// Only scopes from this callback's token exchange count; Better Auth merges old scopes.
const callbackScopes = new WeakMap<object, ReadonlyArray<string>>()

async function recordStorageConsent(account: {
  id: string
  userId: string
  providerId: string
  scope?: string | null
}) {
  const state = await getOAuthState()
  if (
    account.providerId !== 'google' ||
    state?.link?.userId !== account.userId ||
    state.serverContext?.driveConsentUserId !== account.userId
  )
    return
  const scopes = callbackScopes.get(state)
  if (!scopes) return
  await env.AUTH_DB.prepare(
    'UPDATE account SET driveConnected = ?, scope = ? WHERE id = ? AND userId = ?',
  )
    .bind(
      hasScopes(scopes, googlePermissions[0].scopes) ? 1 : 0,
      scopes.join(','),
      account.id,
      account.userId,
    )
    .run()
}

export function getAuth() {
  const googleProvider = google({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  })
  return betterAuth({
    appName: 'Concept',
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path !== '/link-social' ||
          ctx.body?.provider !== 'google' ||
          !Array.isArray(ctx.body.scopes) ||
          !hasScopes(ctx.body.scopes, googlePermissions[0].scopes)
        )
          return
        const session = await getSessionFromCtx(ctx)
        if (session)
          await addOAuthServerContext({ driveConsentUserId: session.user.id })
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({ data: { ...account, idToken: null } }),
          after: recordStorageConsent,
        },
        update: {
          before: async (account) => ({ data: { ...account, idToken: null } }),
          after: recordStorageConsent,
        },
        delete: {
          // Let `ON DELETE CASCADE` on `user` remove accounts during user deletion so `0003_sign_in_guards.sql` only guards unlinking.
          before: async (_account, ctx) =>
            ctx?.path === '/delete-user' ||
            ctx?.path === '/delete-user/callback'
              ? false
              : undefined,
        },
      },
    },
    // Only server-side storage adapters may retrieve provider credentials.
    disabledPaths: ['/get-access-token', '/refresh-token', '/account-info'],
    database: env.AUTH_DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    plugins: [
      passkey({
        rpName: 'Concept',
        origin: env.BETTER_AUTH_URL,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      }),
      oneTap({ clientId: env.GOOGLE_CLIENT_ID }),
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: 'offline',
        includeGrantedScopes: true,
        async getUserInfo(tokens) {
          const profile = await googleProvider.getUserInfo(tokens)
          const state = await getOAuthState()
          if (profile?.user && state)
            callbackScopes.set(state, tokens.scopes ?? [])
          return profile
        },
      },
    },
    account: {
      encryptOAuthTokens: true,
      additionalFields: {
        driveConnected: { type: 'boolean', defaultValue: false, input: false },
      },
      // Storage access is restored through explicit linking, never ordinary sign-in.
      updateAccountOnSignIn: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowUnlinkingAll: true,
      },
    },
  })
}

// Provider credentials are only available to authenticated server-side storage adapters.
export async function getProviderAccessToken(
  headers: Headers,
  accountId: string,
  requiredScopes: ReadonlyArray<string>,
) {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers })
  if (!session) throw new Error('Sign in to use a storage connection.')
  const accounts = await auth.api.listUserAccounts({ headers })
  const account = accounts.find((item) => item.id === accountId)
  if (!account) throw new Error('Connection not found.')
  if (!('driveConnected' in account) || account.driveConnected !== true) {
    throw new Error('Connect storage in account settings first.')
  }
  if (!requiredScopes.every((scope) => account.scopes.includes(scope))) {
    throw new Error(
      'Additional permissions are required. Reconnect in account settings.',
    )
  }
  try {
    const tokens = await auth.api.getAccessToken({
      headers,
      body: { accountId },
    })
    if (!tokens.accessToken) throw new Error('Missing provider token')
    return tokens
  } catch {
    throw new Error(
      'Connection expired or revoked. Reconnect in account settings.',
    )
  }
}

export async function disconnectStorageCredentials(
  headers: Headers,
  accountId: string,
) {
  const session = await getAuth().api.getSession({ headers })
  if (!session) throw new Error('Sign in to manage connections.')
  await env.AUTH_DB.prepare(
    'UPDATE account SET driveConnected = 0, accessToken = NULL, refreshToken = NULL, idToken = NULL, accessTokenExpiresAt = NULL, refreshTokenExpiresAt = NULL, scope = NULL, updatedAt = ? WHERE id = ? AND userId = ?',
  )
    .bind(Date.now(), accountId, session.user.id)
    .run()
}
