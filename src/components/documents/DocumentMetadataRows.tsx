import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { DocumentInfo } from '#/lib/documents/storage'
import { storageLocations } from '#/lib/documents/storage-locations'
import { DriveIcon } from './icons/DriveIcon'

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

export function DetailRows({
  rows,
  className = 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm',
}: {
  rows: Array<[string, ReactNode]>
  className?: string
}) {
  return (
    <dl className={className}>
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

export function metadataRows(
  document: DocumentInfo,
): Array<[string, ReactNode]> {
  return [
    ['Name', document.name],
    ['Location', <StorageLocation key="location" document={document} />],
    ['Library updated', new Date(document.updatedAt).toLocaleString()],
    ['Document ID', document.id],
  ]
}
