import { useState, useEffect } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'

export const CANARY_WARNING_STORAGE_KEY = 'concept:canary-warning-acknowledged'

export interface CanaryWarningDialogProps {
  storageKey?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onAcknowledge?: () => void
}

export function CanaryWarningDialog({
  storageKey = CANARY_WARNING_STORAGE_KEY,
  open: controlledOpen,
  onOpenChange,
  onAcknowledge,
}: CanaryWarningDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isAcknowledged, setIsAcknowledged] = useState(false)
  const [isChecked, setIsChecked] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'true') {
        setIsAcknowledged(true)
        setInternalOpen(false)
      } else {
        setIsAcknowledged(false)
        setInternalOpen(true)
      }
    } catch {
      setIsAcknowledged(false)
      setInternalOpen(true)
    }
  }, [storageKey])

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isAcknowledged) {
      return
    }
    if (!isControlled) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  const handleAcknowledge = () => {
    if (!isChecked) return

    try {
      localStorage.setItem(storageKey, 'true')
    } catch {
      // Storage might be disabled in private browsing
    }
    setIsAcknowledged(true)
    if (!isControlled) {
      setInternalOpen(false)
    }
    onAcknowledge?.()
    onOpenChange?.(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/15 text-destructive ring-1 ring-destructive/30 dark:bg-destructive/25">
            <AlertTriangleIcon className="size-8" />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-xl font-semibold text-destructive">
            Pre-Alpha Canary Warning
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2.5 text-left text-sm text-muted-foreground">
            <span className="block">
              Concept is currently in an{' '}
              <strong>experimental pre-alpha/canary state</strong>. Core storage
              architectures, synchronization engines, and document formats are
              unstable and undergo active, breaking changes without prior
              notice.
            </span>
            <span className="block font-medium text-destructive">
              ⚠️ High Risk of Irreversible Data Loss: Your documents may be
              corrupted, reset, or permanently deleted at any time.
            </span>
            <span className="block">
              Do not use Concept as your sole storage for critical or
              irreplaceable information without maintaining independent external
              backups.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-left">
          <Checkbox
            id="canary-acknowledge-checkbox"
            checked={isChecked}
            onCheckedChange={(checked) => setIsChecked(Boolean(checked))}
            className="mt-0.5"
          />
          <Label
            htmlFor="canary-acknowledge-checkbox"
            className="cursor-pointer text-xs leading-relaxed font-normal text-foreground select-none"
          >
            I acknowledge Concept is in very early development and I might lose
            my documents and data.
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
