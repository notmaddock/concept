import { createAuthClient } from 'better-auth/react'
import { oneTapClient } from 'better-auth/client/plugins'
import { env } from '#/env'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    oneTapClient({
      clientId: env.VITE_GOOGLE_CLIENT_ID ?? '',
      autoSelect: false,
      cancelOnTapOutside: true,
      context: 'signin',
    }),
  ],
})
