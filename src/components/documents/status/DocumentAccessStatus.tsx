import { useState } from 'react'
import { CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, XIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Switch } from '#/components/ui/switch'
import type {
  RealtimeCollaborator,
  RealtimeConnectionStatus,
  RealtimeState,
} from '#/lib/documents/realtime/realtime'
import './document-access-status.css'

const connectionLabels: Record<RealtimeConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  revoked: 'Access changed',
  disabled: 'Live collaboration off',
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function CollaboratorRow({
  collaborator,
  onJump,
}: {
  collaborator: RealtimeCollaborator
  onJump?: (collaborator: RealtimeCollaborator) => void
}) {
  const name = collaborator.name ?? 'Guest'
  const status = collaborator.focusing ? 'Editing' : 'Viewing'
  const canJump = Boolean(onJump) && collaborator.focusing && !collaborator.self
  const content = (
    <>
      <span className="relative shrink-0">
        <Avatar size="sm" className="size-6">
          {collaborator.avatar && (
            <AvatarImage src={collaborator.avatar} alt="" />
          )}
          <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        {collaborator.color && (
          <span
            aria-hidden="true"
            data-cursor-color
            className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-popover"
            style={{ backgroundColor: collaborator.color }}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
        {name}
        {collaborator.self && (
          <span className="font-normal text-muted-foreground"> (you)</span>
        )}
      </span>
      <span
        className={`shrink-0 text-[11px] ${collaborator.focusing ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
      >
        {status}
      </span>
    </>
  )
  const rowClassName =
    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left'
  return (
    <li className="flex">
      {canJump ? (
        <button
          type="button"
          onClick={() => onJump?.(collaborator)}
          aria-label={`Jump to ${name}'s cursor`}
          className={`${rowClassName} transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40`}
        >
          {content}
        </button>
      ) : (
        <div className={rowClassName}>{content}</div>
      )}
    </li>
  )
}

function CollaboratorsSection({
  collaborators,
  onJump,
}: {
  collaborators: RealtimeCollaborator[]
  onJump?: (collaborator: RealtimeCollaborator) => void
}) {
  const editing = collaborators.filter(
    (collaborator) => collaborator.focusing,
  ).length
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Collaborators</span>
        <span className="text-muted-foreground">
          {collaborators.length} online
          {editing > 0 && ` · ${editing} editing`}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {collaborators.map((collaborator) => (
          <CollaboratorRow
            key={collaborator.clientID}
            collaborator={collaborator}
            onJump={onJump}
          />
        ))}
      </ul>
    </div>
  )
}

export function DocumentAccessStatus({
  readOnly,
  realtime,
  liveCollaboration,
  onLiveCollaborationChange,
  onJumpToCollaborator,
  storageName,
}: {
  readOnly: boolean
  realtime?: RealtimeState
  liveCollaboration?: boolean
  onLiveCollaborationChange?: (enabled: boolean) => void
  onJumpToCollaborator?: (collaborator: RealtimeCollaborator) => void
  /** Storage backing the document; live collaboration only applies when set. */
  storageName?: string
}) {
  const [open, setOpen] = useState(false)
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
  const collabSupported = storageName !== undefined
  const collaborationOff = collabSupported && liveCollaboration === false
  const commentGranted = realtime?.capabilities?.comment
  const collaborators = realtime?.collaborators ?? []
  const others = collaborators.filter((collaborator) => !collaborator.self)
  const pillLabel = !editGranted
    ? 'View only'
    : others.length > 0
      ? `${others.length} ${others.length === 1 ? 'collaborator' : 'collaborators'}`
      : undefined
  const expanded = pillLabel !== undefined && !collaborationOff

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="document-access-status relative text-muted-foreground"
          />
        }
        aria-label={`Document permissions: ${label}${collaborationOff ? ', live collaboration off' : ''}`}
        title={collaborationOff ? `${label} · Live collaboration off` : label}
        data-collaboration-off={collaborationOff ? '' : undefined}
        data-expanded={expanded}
      >
        <HighestIcon className="size-4" />
        <span className="document-access-status-label" aria-hidden="true">
          {pillLabel ?? ''}
        </span>
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
        {realtime?.status === 'connected' && collaborators.length > 0 && (
          <CollaboratorsSection
            collaborators={collaborators}
            onJump={
              onJumpToCollaborator
                ? (collaborator) => {
                    onJumpToCollaborator(collaborator)
                    setOpen(false)
                  }
                : undefined
            }
          />
        )}
        {collaborationOff && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-100 px-2.5 py-2 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
            <EyeOffIcon
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                Live collaboration off
              </span>
              <span className="text-[11px] leading-snug text-amber-900/80 dark:text-amber-200/80">
                Changes still sync through {storageName} and reconcile
                automatically when someone else edits this document.
              </span>
            </div>
          </div>
        )}
        {collabSupported && liveCollaboration !== undefined && (
          <div className="flex flex-col gap-1.5 border-t pt-3">
            <label className="flex items-center justify-between gap-3 text-xs font-medium">
              Live collaboration
              <Switch
                size="sm"
                checked={liveCollaboration}
                onCheckedChange={(checked) =>
                  onLiveCollaborationChange?.(checked)
                }
              />
            </label>
            {realtime && (
              <p className="text-xs text-muted-foreground">
                {connectionLabels[realtime.status]}
                {realtime.status === 'connected' &&
                  !realtime.collaborators &&
                  ` · ${realtime.peers + 1} online`}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
