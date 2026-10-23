import { documentSaveProviders } from '#/lib/documents/transfer'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function DocumentShareDialog({
  open,
  onOpenChange,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopy: () => void
}) {
  const canShare = documentSaveProviders.some(
    (provider) => provider.supportsSharing,
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sharing is unavailable</DialogTitle>
          <DialogDescription>
            Documents stored in the local library can’t be shared.
            {canShare &&
              ' To edit collaboratively, make a copy to a cloud service.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canShare && (
            <Button
              onClick={() => {
                onOpenChange(false)
                onCopy()
              }}
            >
              Make a copy
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
