import { PasskeySettings } from './PasskeySettings'
import type { LinkedAccount } from './StorageConnections'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth/client'

type MethodProps = {
  accounts: Array<LinkedAccount>
  loading: boolean
  busy: boolean
  onGoogle: () => void
  onUnlink: () => void
}

function GoogleSignInMethod({
  accounts,
  loading,
  busy,
  onGoogle,
  onUnlink,
  canUnlink,
}: MethodProps & { canUnlink: boolean }) {
  const google = accounts.find((account) => account.providerId === 'google')
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <img src="/icons/google.png" alt="" className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Google</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading ? 'Loading…' : google ? 'Linked' : 'Not linked'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || loading || (!!google && !canUnlink)}
          onClick={google ? onUnlink : onGoogle}
        >
          {google ? 'Unlink' : 'Link'}
        </Button>
      </div>
      {google &&
        canUnlink &&
        google.scopes.some((scope) =>
          scope.startsWith('https://www.googleapis.com/auth/drive.'),
        ) && (
          <p className="-mt-3 text-xs text-muted-foreground">
            Unlinking Google also disconnects Google Drive.
          </p>
        )}
      {google && !canUnlink && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Add another sign-in method before unlinking Google.
        </p>
      )}
    </>
  )
}

export function SignInSettings(props: MethodProps) {
  const { data: passkeys, isPending } = authClient.useListPasskeys()
  const canUnlink =
    props.accounts.length > 1 || (!isPending && !!passkeys?.length)
  return (
    <div className="space-y-6">
      <h2 className="font-heading text-lg font-medium">Sign in</h2>
      <GoogleSignInMethod {...props} canUnlink={canUnlink} />
      <PasskeySettings otherSignInAvailable={props.accounts.length > 0} />
    </div>
  )
}
