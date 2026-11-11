import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { $getRoot, RootNode } from 'lexical'
import type { LexicalEditor } from 'lexical'
import type { Doc } from 'yjs'
import type { DocumentInfo } from '#/lib/documents/storage'
import { encodeStateAsUpdate } from 'yjs'
import { documentAssets } from '#/lib/documents/working'
import { formatFileSize } from '#/lib/documents/format'
import { $getPageSetup, pageDimensions } from '#/lib/documents/page-setup'
import type { PageSetup } from '#/lib/documents/page-setup'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DetailRows,
  metadataRows,
  StorageLocation,
} from '../DocumentMetadataRows'

export { StorageLocation }
export { DocumentDetailsPopover } from '../list/DocumentDetailsPopover'

function pageSetupRows(setup: PageSetup): Array<[string, string]> {
  if (setup.mode !== 'paper') return [['Layout', 'Pageless']]
  const { width, height } = pageDimensions(setup)
  const [displayWidth, displayHeight] = [width, height].map((value) =>
    Number(value.toFixed(2)).toLocaleString(),
  )
  const [top, right, bottom, left] = [
    setup.margins.top,
    setup.margins.right,
    setup.margins.bottom,
    setup.margins.left,
  ].map((value) => Number(value.toFixed(2)).toLocaleString())
  return [
    ['Layout', 'Paged'],
    [
      'Paper size',
      `${
        setup.size === 'custom' ? 'Custom' : setup.size
      } · ${setup.orientation === 'portrait' ? 'Portrait' : 'Landscape'} · ${displayWidth} × ${displayHeight} mm`,
    ],
    [
      'Margins',
      `Top ${top} mm · Right ${right} mm · Bottom ${bottom} mm · Left ${left} mm`,
    ],
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
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
      let pending = false
      let disposed = false
      function refresh() {
        if (!editor || !doc) return
        const { text, setup } = editor.getEditorState().read(() => ({
          text: $getRoot().getTextContent(),
          setup: $getPageSetup(),
        }))
        let words = 0
        for (const part of segmenter.segment(text)) if (part.isWordLike) words++
        let characters = 0
        for (const _character of text) characters++
        const bytes = encodeStateAsUpdate(doc).byteLength
        setStatistics([
          ['Words', words.toLocaleString()],
          ['Characters', characters.toLocaleString()],
          ['Document state', formatFileSize(bytes)],
          ['Format', 'Concept · Version 2'],
          ...pageSetupRows(setup),
        ])
      }
      refresh()
      const schedule = () => {
        if (pending) return
        pending = true
        queueMicrotask(() => {
          pending = false
          if (!disposed) refresh()
        })
      }
      unsubscribe = editor.registerUpdateListener(
        ({ dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size || dirtyLeaves.size) schedule()
        },
      )
      doc.on('update', schedule)
      const unsubscribeRoot = editor.registerMutationListener(
        RootNode,
        schedule,
      )
      const unsubscribeAssets = documentAssets(doc)?.subscribe(schedule)
      detach = () => {
        disposed = true
        unsubscribeRoot()
        unsubscribeAssets?.()
        doc.off('update', schedule)
      }
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
