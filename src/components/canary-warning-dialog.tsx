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
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from '#/components/ui/field'

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
        if (!next) return
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

        <FieldLabel>
          <Field orientation="horizontal">
            <Checkbox
              id="canary-acknowledge-checkbox"
              checked={isChecked}
              onCheckedChange={(checked) => setIsChecked(Boolean(checked))}
            />
            <FieldContent>
              <FieldTitle className="leading-normal font-normal text-foreground">
                I acknowledge Concept is in very early development and I might
                lose my documents
              </FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>

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
