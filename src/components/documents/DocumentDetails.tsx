import { Fragment, useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { $getRoot } from 'lexical'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import type { DocumentInfo } from '#/lib/documents/storage'
import { serializeConcept } from '#/lib/documents/concept-file'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { StorageLocation } from './DocumentDetailsPopover'

export { DocumentDetailsPopover } from './DocumentDetailsPopover'

function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
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

function metadataRows(document: DocumentInfo): Array<[string, ReactNode]> {
  return [
    ['Name', document.name],
    ['Location', <StorageLocation key="location" />],
    ['Library updated', new Date(document.updatedAt).toLocaleString()],
    ['Document ID', document.id],
  ]
}

export function DocumentDetailsDialog({
  document,
  documentRef,
  editorRef,
  onOpenChange,
}: {
  document: DocumentInfo
  documentRef: RefObject<Doc | null>
  editorRef: RefObject<LexicalEditor | null>
  onOpenChange: (open: boolean) => void
}) {
  const [statistics, setStatistics] = useState<Array<[string, string]> | null>(
    null,
  )

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let detach: (() => void) | undefined
    function connect() {
      const editor = editorRef.current
      const doc = documentRef.current
      if (!editor || !doc) return false
      function refresh() {
        if (!editor || !doc) return
        const text = editor
          .getEditorState()
          .read(() => $getRoot().getTextContent())
        const words = Array.from(
          new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
        ).filter((part) => part.isWordLike).length
        const bytes = new Blob([serializeConcept(document.name, doc)]).size
        setStatistics([
          ['Words', words.toLocaleString()],
          ['Characters', Array.from(text).length.toLocaleString()],
          [
            'File size (.concept)',
            `${bytes.toLocaleString()} bytes (${(bytes / 1024).toFixed(1)} KB)`,
          ],
          ['Format', 'Concept · Version 1'],
        ])
      }
      refresh()
      unsubscribe = editor.registerUpdateListener(refresh)
      doc.on('update', refresh)
      detach = () => doc.off('update', refresh)
      return true
    }
    const timer = connect()
      ? undefined
      : setInterval(() => {
          if (connect()) clearInterval(timer)
        }, 100)
    return () => {
      clearInterval(timer)
      unsubscribe?.()
      detach?.()
    }
  }, [document.id, document.name, documentRef, editorRef])

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90svh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Document details</DialogTitle>
        </DialogHeader>
        <DetailRows rows={metadataRows(document)} />
        <div className="border-t pt-4">
          {statistics ? (
            <DetailRows rows={statistics} />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Waiting for document contents…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
