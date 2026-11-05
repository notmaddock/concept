import { LoaderCircleIcon } from 'lucide-react'
import { DriveIcon } from '../icons/DriveIcon'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function ProvidersDialog({
  open,
  onOpenChange,
  connected,
  loading,
  onConnect,
  onDisconnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connected: boolean
  loading: boolean
  onConnect: () => Promise<void>
  onDisconnect: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Manage providers</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <DriveIcon className="size-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Google Drive</p>
            <p className="text-xs text-muted-foreground">
              {connected ? 'Connected' : 'Not connected'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={connected ? onDisconnect : () => void onConnect()}
          >
            {loading && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {connected ? 'Disconnect' : 'Connect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
