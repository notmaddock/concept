import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { authClient } from '#/lib/auth/client'
import { env } from '#/env'

export function OneTapPrompt() {
  const { data: session, isPending, error, refetch } = authClient.useSession()
  const attempted = useRef(false)

  useEffect(() => {
    if (
      !env.VITE_GOOGLE_CLIENT_ID ||
      isPending ||
      session ||
      error ||
      attempted.current
    )
      return
    attempted.current = true
    void authClient
      .oneTap({
        fetchOptions: {
          onSuccess: () => {
            void refetch()
          },
          onError: ({ error: signInError }) => {
            toast.error(signInError.message || 'Could not sign in with Google.')
          },
        },
      })
      .catch(() => {
        // Script blocking or an unavailable prompt leaves the account menu as the fallback.
      })
  }, [isPending, session, error, refetch])

  return null
}
