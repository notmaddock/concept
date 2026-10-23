import { useState } from 'react'
import { FingerprintIcon, LoaderCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '#/lib/auth/client'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function isFreshSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string; status?: number }
  return (
    err.code === 'SESSION_NOT_FRESH' ||
    (err.status === 403 &&
      (err.message?.toLowerCase().includes('fresh') ?? false)) ||
    (err.message?.toLowerCase().includes('session is not fresh') ?? false)
  )
}

export type ReauthDialogProps = {
  open: boolean
  onClose: (reason?: 'cancelled' | 'dismissed') => void
  onSuccess: () => Promise<void> | void
  userId?: string
  hasGoogle?: boolean
  hasPasskey?: boolean
}

export function ReauthDialog({
  open,
  onClose,
  onSuccess,
  userId,
  hasGoogle = true,
  hasPasskey = true,
}: ReauthDialogProps) {
  const [busy, setBusy] = useState<'google' | 'passkey' | null>(null)

  async function handlePasskey() {
    setBusy('passkey')
    try {
      const res = await authClient.signIn.passkey()
      if (res.error) {
        toast.error(res.error.message ?? 'Authentication cancelled')
        return
      }
      const session = await authClient.getSession()
      if (session.error || !session.data || !userId) {
        toast.error('Could not verify your session. Please try again.')
        return
      }
      if (session.data.user.id !== userId) {
        toast.error('Reauthenticated with a different account.')
        return
      }
      onClose('dismissed')
      await onSuccess()
    } catch {
      toast.error('Authentication cancelled')
    } finally {
      setBusy(null)
    }
  }

  async function handleGoogle() {
    setBusy('google')
    try {
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: window.location.href,
      })
      if (res.error) {
        toast.error(res.error.message ?? 'Authentication cancelled')
        return
      }
      // Social sign-in starts a full-page redirect. The current session is still
      // stale here; retrying the captured mutation must wait for a new page.
    } catch {
      toast.error('Authentication cancelled')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val && !busy) {
          toast.error('Authentication cancelled')
          onClose('cancelled')
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm your identity</DialogTitle>
          <DialogDescription>
            Your session is too old for this sensitive action. Please confirm
            your identity to continue. After signing in with Google, retry the
            action.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          {hasPasskey && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void handlePasskey()}
            >
              {busy === 'passkey' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <FingerprintIcon className="size-4" />
              )}
              Confirm with passkey
            </Button>
          )}
          {hasGoogle && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void handleGoogle()}
            >
              {busy === 'google' ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <img src="/icons/google.png" alt="" className="size-4" />
              )}
              Confirm with Google
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              toast.error('Authentication cancelled')
              onClose('cancelled')
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
