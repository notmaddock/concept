import { betterAuth } from 'better-auth'
import { oAuthProxy } from 'better-auth/plugins/oauth-proxy'

export function createAuth(bindings: Cloudflare.Env, origin: string) {
  return betterAuth({
    appName: 'Concept',
    baseURL: origin,
    secret: bindings.BETTER_AUTH_SECRET,
    database: bindings.DB,
    trustedOrigins: bindings.AUTH_TRUSTED_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    account: { encryptOAuthTokens: true },
    disabledPaths: ['/get-access-token', '/refresh-token'],
    socialProviders: {
      google: {
        clientId: bindings.GOOGLE_CLIENT_ID,
        clientSecret: bindings.GOOGLE_CLIENT_SECRET,
        scope: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.install',
        ],
        accessType: 'offline',
        prompt: 'consent',
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: (account) =>
            Promise.resolve({ data: { ...account, idToken: null } }),
        },
        update: {
          before: (account) =>
            Promise.resolve({ data: { ...account, idToken: null } }),
        },
      },
    },
    plugins: [
      oAuthProxy({
        currentURL: origin,
        productionURL: bindings.OAUTH_PROXY_URL,
        secret: bindings.OAUTH_PROXY_SECRET,
      }),
    ],
  })
}

export type ServerAuth = ReturnType<typeof createAuth>
