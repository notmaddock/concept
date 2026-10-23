import { cancelOneTapPrompt } from '#/lib/auth/google-identity'
import { toast } from 'sonner'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '#/lib/auth/client'
import { disconnectStorage } from '#/lib/auth/functions'
import type { LinkedAccount } from './StorageConnections'
import { isFreshSessionError } from './ReauthDialog'

export function useAccountSettings() {
  const { data: session, isPending } = authClient.useSession()
  const userId = session?.user.id
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<'sign-in' | 'connections'>('sign-in')
  const [accounts, setAccounts] = useState<Array<LinkedAccount>>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signInMethod, setSignInMethod] = useState<'google' | 'passkey' | null>(
    null,
  )
  const [error, setError] = useState('')
  const [accountsError, setAccountsError] = useState('')
  const [revision, setRevision] = useState(0)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reauthAction, setReauthAction] = useState<
    (() => Promise<unknown>) | null
  >(null)
  const actionIdRef = useRef(0)

  function reportError(message: string) {
    setError(message)
    toast.error(message)
  }

  useEffect(() => {
    if (!session) {
      setOpen(false)
      setAccounts([])
      setAccountsError('')
      setError('')
      setLoading(false)
      setBusy(false)
      setSignInMethod(null)
    }
  }, [session])

  useEffect(() => {
    actionIdRef.current++
    setReauthOpen(false)
    setReauthAction(null)
    setBusy(false)
    setSignInMethod(null)
    setAccounts([])
    setAccountsError('')
    setError('')
    setLoading(false)
  }, [userId])

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
    if (!open || !userId) return
    let active = true
    const currentUserId = userId
    setLoading(true)
    setAccountsError('')
    function reportAccountsError(message: string) {
      setAccountsError(message)
      toast.error(message)
    }
    void authClient
      .listAccounts()
      .then((result) => {
        if (!active || userIdRef.current !== currentUserId) return
        setLoading(false)
        if (result.error)
          reportAccountsError(
            result.error.message ?? 'Could not load connections.',
          )
        else setAccounts(result.data)
      })
      .catch(() => {
        if (active && userIdRef.current === currentUserId) {
          setLoading(false)
          reportAccountsError('Could not load connections. Try again.')
        }
      })
    return () => {
      active = false
    }
  }, [open, userId, revision])

  async function run(
    action: () => Promise<{
      error?: { message?: string; code?: string } | null
    }>,
  ) {
    const actionUserId = userIdRef.current
    const actionId = ++actionIdRef.current
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (actionId !== actionIdRef.current) return result
      if (actionUserId && userIdRef.current !== actionUserId) return result
      if (result.error) {
        if (isFreshSessionError(result.error)) {
          setReauthAction(() => () => {
            if (userIdRef.current !== actionUserId) return Promise.resolve()
            return run(action)
          })
          setReauthOpen(true)
          return
        }
        reportError(result.error.message ?? 'Could not update your account.')
      }
      return result
    } catch {
      if (actionId !== actionIdRef.current)
        return { error: { message: 'aborted' } }
      if (actionUserId && userIdRef.current !== actionUserId)
        return { error: { message: 'aborted' } }
      reportError(
        'Could not reach the server. Check your connection and try again.',
      )
      return { error: { message: 'Could not reach the server.' } }
    } finally {
      if (actionId === actionIdRef.current) {
        setBusy(false)
      }
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
  const unlinkGoogle = () => {
    const actionUserId = userIdRef.current
    return run(async () => {
      if (!google) return {}
      const result = await authClient.unlinkAccount({ accountId: google.id })
      if (userIdRef.current === actionUserId && !result.error) reload()
      return result
    })
  }
  const disconnectDrive = () => {
    const actionUserId = userIdRef.current
    return run(async () => {
      if (!google) return {}
      await disconnectStorage({ data: { accountId: google.id } })
      if (userIdRef.current === actionUserId) reload()
      return {}
    })
  }
  return {
    section,
    setSection,
    session,
    isPending,
    open: open && Boolean(session),
    setOpen,
    accounts,
    accountsError,
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
    reauthOpen,
    setReauthOpen,
    reauthAction,
    setReauthAction,
  }
}
