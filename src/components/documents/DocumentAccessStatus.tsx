import { EyeIcon, PencilIcon } from 'lucide-react'
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
}: {
  readOnly: boolean
  provider?: 'google-drive'
}) {
  const label = readOnly ? 'View only' : 'Can edit'
  const Icon = readOnly ? EyeIcon : PencilIcon
  const description = readOnly
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
            variant={readOnly ? 'secondary' : 'ghost'}
            size={readOnly ? 'xs' : 'icon-xs'}
            className="text-muted-foreground"
          />
        }
        aria-label={`Document permissions: ${label}`}
        title={label}
      >
        <Icon className="size-4" />
        {readOnly && <span>View only</span>}
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
