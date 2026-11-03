import { useState } from 'react'
import type { ReactElement } from 'react'
import type { DocumentInfo } from '#/lib/documents/storage'
import { storageLocations } from '#/lib/documents/storage-locations'
import { DriveIcon } from './DriveIcon'
import { useIsMobile } from '#/hooks/use-mobile'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'

export function StorageLocation({ document }: { document?: DocumentInfo }) {
  const location = storageLocations.local
  return (
    <span className="inline-flex items-center gap-1.5">
      {document?.drive ? (
        <DriveIcon className="size-3.5 shrink-0" />
      ) : (
        <location.icon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      {document?.drive ? 'Google Drive' : location.label}
    </span>
  )
}

export function DocumentDetailsPopover({
  document,
  children,
}: {
  document: DocumentInfo
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, details) =>
        setOpen(details.reason === 'trigger-press' ? false : nextOpen)
      }
    >
      <PopoverTrigger
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        nativeButton={false}
        openOnHover
        delay={1000}
        closeDelay={150}
        render={children}
      />
      <PopoverContent
        side={isMobile ? 'bottom' : 'right'}
        align="start"
        initialFocus={false}
        finalFocus={false}
        className="w-60 max-w-[min(calc(100vw-2rem),var(--available-width))] max-h-[var(--available-height)] gap-1.5 overflow-y-auto rounded-xl p-3 text-xs"
      >
        <PopoverTitle className="text-sm leading-snug break-words [overflow-wrap:anywhere]">
          {document.name}
        </PopoverTitle>
        <div className="text-muted-foreground">
          <StorageLocation document={document} />
        </div>
        <div className="grid gap-0.5 text-muted-foreground">
          <span>Library updated</span>
          <time dateTime={new Date(document.updatedAt).toISOString()}>
            {new Date(document.updatedAt).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </time>
        </div>
      </PopoverContent>
    </Popover>
  )
}
