import { CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, XIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
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

function PermissionRow({
  granted,
  label,
}: {
  granted: boolean
  label: string
}) {
  const Icon = granted ? CheckIcon : XIcon
  return (
    <li
      data-granted={granted}
      className={`flex items-center gap-2 ${granted ? '' : 'text-muted-foreground'}`}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${granted ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50'}`}
      />
      <span>{label}</span>
    </li>
  )
}

export function DocumentAccessStatus({
  readOnly,
  realtime,
  liveCollaboration,
  onLiveCollaborationChange,
}: {
  readOnly: boolean
  realtime?: RealtimeState
  liveCollaboration?: boolean
  onLiveCollaborationChange?: (enabled: boolean) => void
}) {
  const viewGranted = realtime?.capabilities?.view ?? true
  const editGranted = realtime?.capabilities?.edit ?? !readOnly
  const label = !viewGranted
    ? 'No access'
    : editGranted
      ? 'Can edit'
      : 'View only'
  const HighestIcon = editGranted
    ? PencilIcon
    : viewGranted
      ? EyeIcon
      : EyeOffIcon
  const collaborationOff = liveCollaboration === false
  const commentGranted = realtime?.capabilities?.comment

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative text-muted-foreground"
          />
        }
        aria-label={`Document permissions: ${label}${collaborationOff ? ', live collaboration off' : ''}`}
        title={collaborationOff ? `${label} · Live collaboration off` : label}
        data-collaboration-off={collaborationOff ? '' : undefined}
      >
        <HighestIcon className="size-4" />
        {collaborationOff && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4"
      >
        <div className="flex flex-col gap-2">
          <PopoverTitle className="text-sm">Permissions</PopoverTitle>
          <ul className="flex flex-col gap-1.5 text-xs">
            <PermissionRow
              granted={viewGranted}
              label={
                viewGranted
                  ? 'You can view this file'
                  : "You can't view this file"
              }
            />
            <PermissionRow
              granted={editGranted}
              label={
                editGranted
                  ? 'You can edit this file'
                  : "You can't edit this file"
              }
            />
            {commentGranted !== undefined && (
              <PermissionRow
                granted={commentGranted}
                label={
                  commentGranted
                    ? 'You can comment on this file'
                    : "You can't comment on this file"
                }
              />
            )}
          </ul>
        </div>
        {collaborationOff && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
            <EyeOffIcon aria-hidden="true" className="size-3.5" />
            Live collaboration off
          </div>
        )}
        {liveCollaboration !== undefined && (
          <div className="flex flex-col gap-1.5 border-t pt-3">
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
