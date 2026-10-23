import { cancelOneTapPrompt } from '#/lib/auth/google-identity'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { authClient } from '#/lib/auth/client'
import { disconnectStorage } from '#/lib/auth/functions'
import type { LinkedAccount } from './StorageConnections'

export function useAccountSettings() {
  const { data: session, isPending } = authClient.useSession()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<'sign-in' | 'connections'>('sign-in')
  const [accounts, setAccounts] = useState<Array<LinkedAccount>>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signInMethod, setSignInMethod] = useState<'google' | 'passkey' | null>(
    null,
  )
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  function reportError(message: string) {
    setError(message)
    toast.error(message)
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    const result = url.searchParams.get('accountConnection')
    if (!result) return
    setOpen(true)
    if (url.searchParams.get('accountSection') === 'connections')
      setSection('connections')
    url.searchParams.delete('accountSection')
    if (result === 'error')
      reportError(
        'Google did not complete the connection. Try again and approve the required permissions.',
      )
    url.searchParams.delete('accountConnection')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    window.history.replaceState(window.history.state, '', url)
  }, [])

  function callbackURL(result: 'complete' | 'error') {
    const url = new URL(window.location.href)
    url.searchParams.set('accountConnection', result)
    url.searchParams.set('accountSection', section)
    return url.href
  }

  useEffect(() => {
    if (!open || !session) return
    let active = true
    setLoading(true)
    void authClient
      .listAccounts()
      .then((result) => {
        if (!active) return
        setLoading(false)
        if (result.error)
          reportError(result.error.message ?? 'Could not load connections.')
        else setAccounts(result.data)
      })
      .catch(() => {
        if (active) {
          setLoading(false)
          reportError('Could not load connections. Try again.')
        }
      })
    return () => {
      active = false
    }
  }, [open, session, revision])

  async function run(
    action: () => Promise<{ error?: { message?: string } | null }>,
  ) {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (result.error)
        reportError(result.error.message ?? 'Could not update your account.')
    } catch {
      reportError(
        'Could not reach the server. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  function connect(scopes: ReadonlyArray<string>) {
    return run(() =>
      authClient.linkSocial({
        provider: 'google',
        scopes: [...scopes],
        callbackURL: callbackURL('complete'),
        errorCallbackURL: callbackURL('error'),
        additionalParams: { prompt: 'consent' },
      }),
    )
  }

  const google = accounts.find((account) => account.providerId === 'google')

  const reload = () => setRevision((value) => value + 1)
  async function signIn(method: 'google' | 'passkey' = 'google') {
    cancelOneTapPrompt()
    setSignInMethod(method)
    try {
      await run(() =>
        method === 'google'
          ? authClient.signIn.social({
              provider: 'google',
              callbackURL: window.location.href,
              errorCallbackURL: callbackURL('error'),
            })
          : authClient.signIn.passkey(),
      )
    } finally {
      setSignInMethod(null)
    }
  }
  const unlinkGoogle = () =>
    run(async () => {
      if (!google) return {}
      const result = await authClient.unlinkAccount({ accountId: google.id })
      if (!result.error) reload()
      return result
    })
  const disconnectDrive = () =>
    run(async () => {
      if (!google) return {}
      await disconnectStorage({ data: { accountId: google.id } })
      reload()
      return {}
    })
  return {
    section,
    setSection,
    session,
    isPending,
    open,
    setOpen,
    accounts,
    loading,
    busy,
    error,
    setError,
    run,
    connect,
    reload,
    signIn,
    signInMethod,
    unlinkGoogle,
    disconnectDrive,
    setAccounts,
  }
}
