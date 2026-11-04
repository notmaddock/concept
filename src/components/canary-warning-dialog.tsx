import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'

export const CANARY_WARNING_STORAGE_KEY = 'concept:canary-warning-acknowledged'

export function CanaryWarningDialog({
  storageKey = CANARY_WARNING_STORAGE_KEY,
}: {
  storageKey?: string
} = {}) {
  const [open, setOpen] = useState(false)
  const [isChecked, setIsChecked] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) !== 'true') {
        setOpen(true)
      }
    } catch {
      setOpen(true)
    }
  }, [storageKey])

  const handleAcknowledge = () => {
    if (!isChecked) return
    try {
      localStorage.setItem(storageKey, 'true')
    } catch {
      // Storage unavailable
    }
    setOpen(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isChecked) return
        setOpen(next)
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="gap-2 text-left">
          <AlertDialogTitle className="font-heading text-lg font-medium">
            Welcome to Concept!
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-muted-foreground">
            <span className="block">
              Concept is in very early development and is in pre-alpha. The
              document format is still being worked on and might not be fully
              backwards-compatible.
            </span>
            <span className="block">
              Feel free to check Concept out, write short documents, and export
              them, but until 1.0 your documents might break.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-left">
          <Checkbox
            id="canary-acknowledge-checkbox"
            checked={isChecked}
            onCheckedChange={(checked) => setIsChecked(Boolean(checked))}
            className="mt-0.5"
          />
          <Label
            htmlFor="canary-acknowledge-checkbox"
            className="cursor-pointer leading-normal text-foreground select-none"
          >
            I acknowledge Concept is in very early development and I might lose
            my documents
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction
            variant="destructive"
            disabled={!isChecked}
            onClick={handleAcknowledge}
            className="w-full sm:w-auto"
          >
            Acknowledge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
