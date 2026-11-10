import { Button } from '#/components/ui/button'
import { driveFileUrl } from '#/lib/documents/drive/api'
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
  driveFileId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopy: () => void
  driveFileId?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {driveFileId ? 'Share in Google Drive' : 'Sharing is unavailable'}
          </DialogTitle>
          <DialogDescription>
            {driveFileId
              ? 'Google Drive controls who can access this document. Manage sharing in Drive.'
              : 'Documents stored in the local library can’t be shared. To edit collaboratively, make a copy to a cloud service.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {driveFileId ? (
            <Button
              nativeButton={false}
              render={
                <a
                  href={driveFileUrl(driveFileId)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Open in Google Drive
            </Button>
          ) : (
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
