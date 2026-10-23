import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function RenamePasskeyDialog({
  name,
  busy,
  onRename,
  onClose,
}: {
  name: string
  busy: boolean
  onRename: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(name)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent showCloseButton={!busy} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Rename passkey</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && value.trim()) onRename(value.trim())
          }}
        >
          <label className="grid gap-2 text-sm">
            Passkey name
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={100}
              disabled={busy}
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
