import type { DocumentAccess } from '#/lib/documents/access'
import { AlertTriangleIcon, EyeIcon, PencilIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'

export function DocumentAccessStatus({
  readOnly,
  provider,
  access,
  recoveryOnly = false,
}: {
  readOnly: boolean
  provider?: 'google-drive'
  access?: DocumentAccess
  recoveryOnly?: boolean
}) {
  const unavailable = !recoveryOnly && access?.kind === 'unavailable'
  const unverified = access?.kind === 'unverified'
  const label = recoveryOnly
    ? 'Local recovery'
    : unavailable
      ? 'Access unavailable'
      : unverified
        ? 'Access unverified'
        : readOnly
          ? 'View only'
          : 'Can edit'
  const Icon =
    unavailable || unverified
      ? AlertTriangleIcon
      : readOnly
        ? EyeIcon
        : PencilIcon
  const description = recoveryOnly
    ? 'Recover retained work into a local copy to open it.'
    : unavailable
      ? 'You no longer have access to this file, or it is unavailable.'
      : unverified
        ? 'Drive access could not be verified. Available offline work is preserved locally.'
        : readOnly
          ? provider
            ? 'You can only view this document. Ask the owner to give you edit access in Google Drive.'
            : 'You can only view this local document. Editing is disabled for this copy.'
          : provider
            ? 'You can edit this document. Changes sync to Google Drive.'
            : 'You can edit this document. Changes are saved locally in this browser.'

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={
              readOnly || unavailable || unverified ? 'secondary' : 'ghost'
            }
            size={readOnly || unavailable || unverified ? 'xs' : 'icon-xs'}
            className={
              unavailable
                ? 'text-red-600 dark:text-red-400'
                : unverified
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-muted-foreground'
            }
          />
        }
        aria-label={`Document permissions: ${label}`}
        title={label}
      >
        <Icon className="size-4" />
        {(readOnly || unavailable || unverified) && <span>{label}</span>}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] gap-2 rounded-xl p-4"
      >
        <PopoverTitle className="text-sm">{label}</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed">
          {description}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
