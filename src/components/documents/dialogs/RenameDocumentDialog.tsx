import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function RenameDocumentDialog({
  name,
  onRename,
  onClose,
}: {
  name: string
  onRename: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [value, setValue] = useState(name)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  async function save() {
    if (pendingRef.current || !value.trim()) return
    pendingRef.current = true
    setPending(true)
    try {
      if (await onRename(value.trim())) onClose()
    } catch {
      // Rename failures are reported via toast by the caller.
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pendingRef.current) onClose()
      }}
    >
      <DialogContent showCloseButton={!pending} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="grid gap-4"
        >
          <label className="grid gap-2 text-sm">
            Document name
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={1000}
              disabled={pending}
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !value.trim()}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
