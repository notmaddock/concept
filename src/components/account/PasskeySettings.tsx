import { useEffect, useState } from 'react'
import { getAuthenticatorName } from '@better-auth/passkey'
import { toast } from 'sonner'
import { RenamePasskeyDialog } from './RenamePasskeyDialog'
import { ReauthDialog, isFreshSessionError } from './ReauthDialog'
import { FingerprintIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { authClient } from '#/lib/auth/client'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'

export function PasskeySettings({
  otherSignInAvailable,
}: {
  otherSignInAvailable: boolean
}) {
  const {
    data: passkeys,
    isPending,
    error: loadError,
    refetch,
  } = authClient.useListPasskeys()
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  )
  useEffect(() => {
    if (loadError)
      toast.error('Could not load passkeys.', { id: 'passkey-load-error' })
  }, [loadError])
  const { data: session } = authClient.useSession()
  const [reauthOpen, setReauthOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<
    | (() => Promise<{ error?: { message?: string; code?: string } | null }>)
    | null
  >(null)
  const [removing, setRemoving] = useState<{
    id: string
    name?: string | null
  } | null>(null)

  async function update(
    action: () => Promise<{
      error?: { message?: string; code?: string } | null
    }>,
  ) {
    setBusy(true)
    try {
      const result = await action()
      if (result.error) {
        if (isFreshSessionError(result.error)) {
          setPendingAction(() => action)
          setReauthOpen(true)
          return
        }
        toast.error(result.error.message ?? 'Could not update passkeys.')
      } else {
        setRemoving(null)
        setRenaming(null)
        void refetch()
      }
    } catch {
      toast.error('Could not update passkeys. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Passkeys" className="space-y-4 border-t pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">Passkeys</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Use your fingerprint, face, or a security key.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || isPending}
          onClick={() => void update(() => authClient.passkey.addPasskey())}
        >
          <PlusIcon /> Add
        </Button>
      </div>
      {loadError && (
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      )}
      {isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading passkeys…
        </p>
      ) : !passkeys?.length ? (
        <p className="text-xs text-muted-foreground">No passkeys added.</p>
      ) : (
        <div className="divide-y rounded-xl border">
          {passkeys.map((key) => (
            <div key={key.id} className="flex items-center gap-3 p-3">
              <FingerprintIcon className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {key.name || getAuthenticatorName(key.aaguid) || 'Passkey'}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Rename ${key.name || getAuthenticatorName(key.aaguid) || 'passkey'}`}
                onClick={() =>
                  setRenaming({
                    id: key.id,
                    name:
                      key.name || getAuthenticatorName(key.aaguid) || 'Passkey',
                  })
                }
              >
                <PencilIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={
                  busy || (!otherSignInAvailable && passkeys.length === 1)
                }
                aria-label={`Remove ${key.name || getAuthenticatorName(key.aaguid) || 'passkey'}`}
                onClick={() => setRemoving(key)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      )}
      {renaming && (
        <RenamePasskeyDialog
          key={renaming.id}
          name={renaming.name}
          busy={busy}
          onClose={() => setRenaming(null)}
          onRename={(name) =>
            void update(() =>
              authClient.passkey.updatePasskey({ id: renaming.id, name }),
            )
          }
        />
      )}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              You won’t be able to sign in with this passkey. Your other sign-in
              methods will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (removing)
                  void update(() =>
                    authClient.passkey.deletePasskey({ id: removing.id }),
                  )
              }}
            >
              Remove passkey
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reauthOpen && (
        <ReauthDialog
          open={reauthOpen}
          onClose={() => {
            setReauthOpen(false)
            setPendingAction(null)
          }}
          onSuccess={async () => {
            if (pendingAction) {
              const act = pendingAction
              setPendingAction(null)
              await update(act)
            }
          }}
          userId={session?.user.id}
          hasGoogle={otherSignInAvailable}
          hasPasskey={true}
        />
      )}
    </section>
  )
}
