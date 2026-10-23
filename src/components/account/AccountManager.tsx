import { useState } from 'react'
import { authClient } from '#/lib/auth/client'
import { AccountMenu } from './AccountMenu'
import { AccountSettingsDialog } from './AccountSettingsDialog'
import { SignOutConfirmation } from './SignOutConfirmation'
import { useAccountSettings } from './use-account-settings'

export function AccountManager() {
  const settings = useAccountSettings()
  const [signOutOpen, setSignOutOpen] = useState(false)
  return (
    <>
      <AccountMenu
        user={settings.session?.user}
        busy={settings.busy || settings.isPending}
        signInMethod={settings.signInMethod}
        onGoogle={() => void settings.signIn()}
        onPasskey={() => void settings.signIn('passkey')}
        onSettings={() => {
          settings.setError('')
          settings.setOpen(true)
        }}
        onSignOut={() => {
          settings.setError('')
          setSignOutOpen(true)
        }}
      />
      {settings.session && <AccountSettingsDialog settings={settings} />}
      <SignOutConfirmation
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        busy={settings.busy}
        onConfirm={() =>
          void settings.run(async () => {
            const result = await authClient.signOut()
            if (!result.error) {
              settings.setAccounts([])
              settings.setOpen(false)
              setSignOutOpen(false)
            }
            return result
          })
        }
      />
    </>
  )
}
