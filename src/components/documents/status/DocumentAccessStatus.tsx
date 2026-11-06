import { EyeIcon, PencilIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import type {
  RealtimeConnectionStatus,
  RealtimeState,
} from '#/lib/documents/realtime/realtime'

const connectionLabels: Record<RealtimeConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  revoked: 'Access changed',
  disabled: 'Disabled',
}

export function DocumentAccessStatus({
  readOnly,
  provider,
  realtime,
  liveCollaboration,
  onLiveCollaborationChange,
}: {
  readOnly: boolean
  provider?: 'google-drive'
  realtime?: RealtimeState
  liveCollaboration?: boolean
  onLiveCollaborationChange?: (enabled: boolean) => void
}) {
  const label = readOnly ? 'View only' : 'Can edit'
  const description = readOnly
    ? provider
      ? 'You can only view this document. Ask the owner to give you edit access in Google Drive.'
      : 'You can only view this local document. Editing is disabled for this copy.'
    : provider
      ? 'You can edit this document. Changes sync to Google Drive.'
      : 'You can edit this document. Changes are saved locally in this browser.'

  const viewGranted = realtime?.capabilities?.view ?? true
  const editGranted = realtime?.capabilities?.edit ?? !readOnly
  const collaborationOff = liveCollaboration === false

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={readOnly ? 'secondary' : 'ghost'}
            size={readOnly ? 'xs' : 'icon-xs'}
            className="text-muted-foreground"
          />
        }
        aria-label={`Document permissions: ${label}`}
        title={label}
      >
        {collaborationOff ? (
          <>
            <span className="hidden items-center gap-1 rounded-full border border-amber-400/60 bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-900 @md/document-header:inline-flex dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
              <EyeIcon className="size-4" />
              Live collaboration off
            </span>
            <EyeIcon
              className={`size-4 @md/document-header:hidden ${viewGranted ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
            />
          </>
        ) : (
          <EyeIcon
            className={`size-4 ${viewGranted ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
          />
        )}
        <PencilIcon
          className={`size-4 ${editGranted ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] gap-2 rounded-xl p-4"
      >
        <PopoverTitle className="text-sm">{label}</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed">
          {description}
        </PopoverDescription>
        {liveCollaboration !== undefined && (
          <div className="mt-1 flex flex-col gap-1.5 border-t pt-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={liveCollaboration}
                onCheckedChange={(checked) =>
                  onLiveCollaborationChange?.(checked === true)
                }
              />
              Live collaboration
            </label>
            {realtime && (
              <p className="text-xs text-muted-foreground">
                {connectionLabels[realtime.status]}
                {realtime.status === 'connected' &&
                  ` · ${realtime.peers + 1} online`}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
