import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { authClient } from '#/lib/auth/client'
import { cancelOneTapPrompt } from '#/lib/auth/google-identity'
import { env } from '#/env'

export function OneTapPrompt() {
  const { data: session, isPending, error, refetch } = authClient.useSession()
  const attempted = useRef(false)

  useEffect(() => {
    if (session) {
      cancelOneTapPrompt()
      return
    }

    if (!env.VITE_GOOGLE_CLIENT_ID || isPending || error || attempted.current) {
      return
    }

    attempted.current = true
    let active = true

    void authClient
      .oneTap({
        fetchOptions: {
          onSuccess: () => {
            if (!active) {
              cancelOneTapPrompt()
              return
            }
            void refetch()
          },
          onError: ({ error: signInError }) => {
            if (!active) {
              cancelOneTapPrompt()
              return
            }
            toast.error(signInError.message || 'Could not sign in with Google.')
          },
        },
      })
      .then(() => {
        if (!active) {
          cancelOneTapPrompt()
        }
      })
      .catch(() => {
        if (!active) {
          cancelOneTapPrompt()
        }
      })

    return () => {
      active = false
      cancelOneTapPrompt()
    }
  }, [isPending, session, error, refetch])

  return null
}
