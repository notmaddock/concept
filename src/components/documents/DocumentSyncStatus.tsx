import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  HardDriveIcon,
  LoaderCircleIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Doc } from 'yjs'
import { conceptFileSize } from '#/lib/documents/serialization'
import { StorageLocation } from './DocumentDetailsPopover'
import type {
  DocumentInfo,
  DocumentSyncStatus as SyncStatus,
} from '#/lib/documents/storage'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'

const states = {
  local: { label: 'Stored in this browser', icon: HardDriveIcon },
  pending: { label: 'Waiting to save', icon: CloudUploadIcon },
  syncing: { label: 'Saving', icon: LoaderCircleIcon },
  synced: { label: 'Saved to Google Drive', icon: CloudCheckIcon },
  offline: { label: 'Offline', icon: CloudOffIcon },
  error: { label: 'Could not sync', icon: CloudAlertIcon },
}

export function DocumentSyncStatus({
  status,
  document,
  documentRef,
  onRetry,
}: {
  status: SyncStatus
  document?: DocumentInfo
  documentRef?: RefObject<Doc | null>
  onRetry?: () => void
}) {
  const { label, icon: Icon } = states[status.state]
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={`Document sync status: ${label}`}
            title={label}
          />
        }
      >
        <Icon
          aria-hidden="true"
          className={
            status.state === 'syncing'
              ? 'size-4 motion-safe:animate-spin'
              : status.state === 'error'
                ? 'size-4 text-destructive'
                : 'size-4 text-muted-foreground'
          }
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2 rounded-xl">
        <PopoverTitle>{label}</PopoverTitle>
        <PopoverDescription role="status">{status.message}</PopoverDescription>
        {document && documentRef && (
          <DocumentStorageDetails
            document={document}
            documentRef={documentRef}
          />
        )}
        {onRetry && ['error', 'offline', 'pending'].includes(status.state) && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry sync
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function DocumentStorageDetails({
  document,
  documentRef,
}: {
  document: DocumentInfo
  documentRef: RefObject<Doc | null>
}) {
  const [size, setSize] = useState<number>()
  useEffect(() => {
    let detach: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    function connect() {
      const doc = documentRef.current
      if (!doc) return false
      const refresh = () => setSize(conceptFileSize(document.name, doc))
      const schedule = () => {
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(refresh, 500)
      }
      refresh()
      doc.on('update', schedule)
      detach = () => doc.off('update', schedule)
      return true
    }
    // The popover can be opened before the editor finishes loading IndexedDB.
    const connectTimer = connect()
      ? undefined
      : setInterval(() => {
          if (connect()) clearInterval(connectTimer)
        }, 100)
    return () => {
      clearInterval(connectTimer)
      clearTimeout(refreshTimer)
      detach?.()
    }
  }, [document.id, document.name, documentRef])
  const unit =
    size === undefined || size < 1024
      ? 0
      : Math.min(3, Math.floor(Math.log(size) / Math.log(1024)))
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
      <dt className="text-muted-foreground">Storage</dt>
      <dd>
        <StorageLocation document={document} />
      </dd>
      <dt className="text-muted-foreground">File size (.concept)</dt>
      <dd
        title={
          size === undefined ? undefined : `${size.toLocaleString()} bytes`
        }
      >
        {size === undefined
          ? 'Calculating…'
          : `${(size / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['bytes', 'KB', 'MB', 'GB'][unit]}`}
      </dd>
    </dl>
  )
}
