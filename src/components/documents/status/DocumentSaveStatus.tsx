import { useEffect, useState } from 'react'
import {
  CircleAlertIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LoaderCircleIcon,
} from 'lucide-react'
import type { SaveStatus } from '#/lib/documents/sync'
import { formatFileSize } from '#/lib/documents/format'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { DriveIcon } from '../icons/DriveIcon'
import './document-save-status.css'

const labels: Record<SaveStatus['phase'], string> = {
  loading: 'Loading saved changes',
  local: 'All changes saved locally',
  synced: 'All changes saved to Drive',
  pending: 'Waiting to save',
  saving: 'Saving to Drive',
  reconciling: 'Reconciling external changes',
  offline: 'Offline',
  'auth-required': 'Reconnect Google Drive',
  error: 'Could not save to Drive',
  'missing-assets': 'Waiting for document assets',
}

function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

export function DocumentSaveStatus({
  status,
  provider,
  onRetry,
  onConnect,
  onSaveToDrive,
  onOfflineChange,
  onOpenContainingFolder,
}: {
  status: SaveStatus
  provider?: 'google-drive'
  onRetry?: () => void
  onConnect?: () => void
  onSaveToDrive?: () => void
  onOfflineChange?: (value: boolean) => void
  onOpenContainingFolder?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  const working = ['loading', 'saving', 'reconciling'].includes(status.phase)
  const label =
    status.readOnly && status.phase === 'synced'
      ? 'View only · Synced with Drive'
      : !provider && status.phase === 'saving'
        ? 'Saving to this device'
        : !provider && status.phase === 'error'
          ? 'Could not save locally'
          : labels[status.phase]
  const Icon = working
    ? LoaderCircleIcon
    : status.phase === 'local'
      ? HardDriveIcon
      : status.phase === 'synced'
        ? CloudCheckIcon
        : status.phase === 'pending'
          ? CloudUploadIcon
          : status.phase === 'offline'
            ? CloudOffIcon
            : CircleAlertIcon
  const expanded = status.phase !== 'local' && status.phase !== 'synced'
  const metadata = [
    [
      'Size',
      status.size === undefined ? undefined : formatFileSize(status.size),
    ],
    ['Revision', status.revision],
    ['Drive revision', status.remoteRevision],
    ['ETag', status.etag],
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="document-save-status text-muted-foreground"
          />
        }
        aria-label={label}
        title={label}
        data-expanded={expanded}
      >
        <Icon
          className={`size-4 text-muted-foreground${working ? ' animate-spin' : ''}`}
        />
        <span className="document-save-status-label" aria-hidden="true">
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4"
      >
        <PopoverTitle className="text-sm">{label}</PopoverTitle>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
          {status.readOnly && (
            <>
              <dt className="text-muted-foreground">Access</dt>
              <dd className="font-medium text-foreground">View only</dd>
            </>
          )}
          {provider && (
            <>
              <dt className="text-muted-foreground">Location</dt>
              <dd className="flex items-center gap-1.5">
                <DriveIcon className="size-3.5" />
                Google Drive
              </dd>
            </>
          )}
          {status.lastSyncedAt !== undefined && (
            <>
              <dt className="text-muted-foreground">Last synced</dt>
              <dd>
                <time
                  dateTime={new Date(status.lastSyncedAt).toISOString()}
                  title={new Date(status.lastSyncedAt).toLocaleString()}
                >
                  {relativeTime(status.lastSyncedAt, now)}
                </time>
              </dd>
            </>
          )}
          {metadata.map(
            ([metadataLabel, value]) =>
              value !== undefined && (
                <div key={metadataLabel} className="contents">
                  <dt className="text-muted-foreground">{metadataLabel}</dt>
                  <dd className="min-w-0 break-all font-mono" title={value}>
                    {value}
                  </dd>
                </div>
              ),
          )}
        </dl>
        {status.error && (
          <p className="text-xs text-muted-foreground">{status.error}</p>
        )}
        {provider && onOfflineChange && (
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            <span className="flex items-center gap-2">
              <HardDriveIcon className="size-4" />
              Available offline
            </span>
            <Switch
              size="sm"
              checked={status.offlineAvailable ?? false}
              onCheckedChange={(value) => onOfflineChange(value)}
            />
          </label>
        )}
        {onOpenContainingFolder && (
          <Button variant="outline" size="sm" onClick={onOpenContainingFolder}>
            <FolderOpenIcon className="size-4" />
            Open containing folder
          </Button>
        )}
        {!provider && onSaveToDrive && (
          <Button variant="outline" size="sm" onClick={onSaveToDrive}>
            <DriveIcon className="size-4" />
            Save to Google Drive
          </Button>
        )}
        {status.phase === 'auth-required' && onConnect && (
          <Button size="sm" onClick={onConnect}>
            Reconnect Google Drive
          </Button>
        )}
        {['error', 'offline', 'pending', 'missing-assets'].includes(
          status.phase,
        ) &&
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Sync now
            </Button>
          )}
      </PopoverContent>
    </Popover>
  )
}
