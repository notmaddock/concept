import { DriveIcon } from '../icons/DriveIcon'
import { DocumentFilePicker } from './DocumentFilePicker'
import { importFormats } from '#/lib/documents/import/formats'
import type { ImportFormat } from '#/lib/documents/import/formats'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, FileTextIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { Doc } from 'yjs'
import type { DocumentInfo } from '#/lib/documents/storage'
import { documentHash } from '#/lib/documents/document-url'
import type {
  DocumentSaveProvider,
  DocumentSource,
  SelectedDocument,
} from '#/lib/documents/transfer'
import {
  documentSaveProviders,
  documentSources,
} from '#/lib/documents/transfer'
import { storageLocations } from '#/lib/documents/storage-locations'
import { readConcept } from '#/lib/documents/concept-file'
import { captureSnapshot } from '#/lib/documents/working'
import { formatFileSize } from '#/lib/documents/format'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function DocumentStorageDialog({
  mode,
  source,
  importFormat,
  onClose,
  sources = documentSources,
  providers = documentSaveProviders,
  onOpenDrive,
  drivePickerDisabled = false,
  driveConnected = true,
}: {
  mode: 'open' | 'copy' | 'import'
  importFormat?: ImportFormat
  source?: { name: string; doc: Doc }
  onClose: () => void
  sources?: Array<DocumentSource>
  providers?: Array<DocumentSaveProvider>
  onOpenDrive?: () => Promise<void>
  drivePickerDisabled?: boolean
  driveConnected?: boolean
}) {
  const format = importFormats.find((item) => item.id === importFormat)
  const navigate = useNavigate()
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [providerId, setProviderId] = useState(
    providers.length === 1 ? providers[0].id : '',
  )
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [listFailed, setListFailed] = useState(false)
  const [selected, setSelected] = useState<SelectedDocument | null>(null)
  const [recover, setRecover] = useState(false)
  const [name, setName] = useState(source ? `Copy of ${source.name}` : '')
  const revision = useRef(0)
  const [documents, setDocuments] = useState<Array<DocumentInfo>>([])
  const openSource = sources.find((item) => item.id === sourceId)
  const provider = providers.find((item) => item.id === providerId)
  const review = mode === 'copy' || selected !== null
  const savesDocument = mode === 'copy' || !selected?.existingId

  useEffect(() => {
    if (openSource?.kind !== 'library') return
    let active = true
    setReading(true)
    setListFailed(false)
    setDocuments([])
    void openSource
      .list()
      .then((items) => {
        if (active) setDocuments(items)
      })
      .catch(() => {
        if (active) {
          setListFailed(true)
          toast.error(
            'Could not load documents. Choose the source again to retry.',
          )
        }
      })
      .finally(() => {
        if (active) setReading(false)
      })
    return () => {
      active = false
    }
  }, [openSource])

  useEffect(
    () => () => {
      revision.current++
    },
    [],
  )

  function changeSource(id: string | null) {
    revision.current++
    setSelected(null)
    setReading(false)
    setListFailed(false)
    setSourceId(id)
  }

  async function readDocument(read: () => Promise<SelectedDocument>) {
    const request = ++revision.current
    setSelected(null)
    setRecover(false)
    setReading(true)
    try {
      const next = await read()
      if (request === revision.current) {
        setSelected(next)
        setName(next.file.name)
        if (next.warnings?.length) {
          const constructs = [
            ...new Set(next.warnings.map((warning) => warning.construct)),
          ]
          toast.warning(
            `Some content could not be imported: ${constructs.join(', ')}.`,
          )
        }
      }
    } catch (cause) {
      if (request === revision.current)
        toast.error(
          cause instanceof Error
            ? cause.message
            : 'Could not read this document.',
        )
    } finally {
      if (request === revision.current) setReading(false)
    }
  }

  async function confirm() {
    if (
      pendingRef.current ||
      reading ||
      !review ||
      (savesDocument && (!provider || !name.trim()))
    )
      return
    pendingRef.current = true
    setPending(true)
    try {
      let id = selected?.existingId
      if (!id) {
        const file =
          mode !== 'copy'
            ? selected?.file
            : source
              ? await captureSnapshot(source.name, source.doc)
              : undefined
        if (!file || !provider)
          throw new Error('Choose a document and save location first.')
        id = (await provider.save(file, name.trim(), selected?.missingAssets))
          .id
      }
      await navigate({ to: '/', hash: documentHash(id) })
      onClose()
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not open the document. Please try again.',
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pendingRef.current) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'import'
              ? `Import from ${format?.label ?? 'file'}`
              : mode === 'open'
                ? 'Open document'
                : 'Make a copy'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'import'
              ? 'Choose a file to convert, then name it and choose where to save it.'
              : mode === 'copy'
                ? 'Name your copy and choose where to save it.'
                : selected
                  ? 'Review the document and choose where you’ll work on it.'
                  : 'Choose where to open your document from.'}
          </DialogDescription>
        </DialogHeader>
        {mode === 'import' && !selected && format && (
          <DocumentFilePicker
            label={`Choose a ${format.label} file`}
            accept={format.extensions.join(',')}
            description={`Import a ${format.label} file from your device.`}
            reading={reading}
            status="Converting document…"
            onSelect={(file) => {
              void readDocument(async () => {
                const { convertImport } = await import('#/lib/documents/import')
                const result = await convertImport(file, format.id)
                return {
                  file: result,
                  warnings: result.warnings,
                  size: file.size,
                  filename: file.name,
                  origin: storageLocations.device.label,
                }
              })
            }}
          />
        )}
        {mode === 'open' && !selected && (
          <div className="grid gap-4">
            {!openSource ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Open from</legend>
                {onOpenDrive && (
                  <Button
                    variant="outline"
                    disabled={drivePickerDisabled}
                    onClick={() => {
                      onClose()
                      void onOpenDrive()
                    }}
                    className="h-auto justify-start gap-3 rounded-xl p-4 text-left"
                  >
                    <DriveIcon />{' '}
                    {driveConnected ? 'Google Drive' : 'Connect Google Drive'}
                  </Button>
                )}
                {sources.map((item) => (
                  <Button
                    key={item.id}
                    variant="outline"
                    onClick={() => changeSource(item.id)}
                    className="h-auto justify-start gap-3 rounded-xl p-4 whitespace-normal text-left"
                  >
                    <item.icon />
                    <span className="grid gap-1">
                      <span>{item.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </fieldset>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <openSource.icon className="size-4 shrink-0" />
                    {openSource.label}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => changeSource(null)}
                    className="shrink-0 text-muted-foreground"
                  >
                    Change source
                  </Button>
                </div>
                {openSource.kind === 'device' ? (
                  <DocumentFilePicker
                    label="Choose a .concept file"
                    accept=".concept"
                    description="Open a .concept file from your device."
                    reading={reading}
                    status="Reading document…"
                    onSelect={(file) => {
                      void readDocument(async () => {
                        if (!file.name.toLowerCase().endsWith('.concept'))
                          throw new Error('Choose a .concept file.')
                        const result = await readConcept(file)
                        return {
                          file: result.snapshot,
                          missingAssets:
                            result.kind === 'incomplete'
                              ? result.missingAssets
                              : undefined,
                          size: file.size,
                          filename: file.name,
                          origin: storageLocations.device.label,
                        }
                      })
                    }}
                  />
                ) : (
                  <div
                    aria-label={`${openSource.label} documents`}
                    className="grid max-h-60 gap-2 overflow-y-auto"
                  >
                    {!reading && !listFailed && documents.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No documents saved here yet. Choose This device to open
                        a .concept file.
                      </p>
                    )}
                    {documents.map((item) => (
                      <Button
                        key={item.id}
                        disabled={reading}
                        variant="outline"
                        className="h-auto justify-start rounded-xl p-3 whitespace-normal text-left"
                        onClick={() =>
                          void readDocument(() => openSource.read(item))
                        }
                      >
                        <FileTextIcon />
                        <span className="min-w-0 break-all">{item.name}</span>
                      </Button>
                    ))}
                  </div>
                )}
                {reading && openSource.kind === 'library' && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Reading document…
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {selected && (
          <div className="grid gap-4">
            <div className="flex items-start justify-between gap-3 rounded-xl border p-4">
              <div className="grid min-w-0 gap-3 text-sm">
                <p className="font-medium break-all">{selected.file.name}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">File</dt>
                  <dd className="break-all">{selected.filename}</dd>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>{formatFileSize(selected.size)}</dd>
                  <dt className="text-muted-foreground">Origin</dt>
                  <dd className="flex items-center gap-1.5">
                    {openSource && (
                      <openSource.icon className="size-3.5 shrink-0" />
                    )}
                    {selected.origin}
                  </dd>
                </dl>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  revision.current++
                  setSelected(null)
                }}
              >
                Change
              </Button>
            </div>
            {selected.existingId && (
              <p className="text-sm text-muted-foreground">
                Opens the existing document in {openSource?.label}. Changes
                continue to save there.
              </p>
            )}
          </div>
        )}
        {selected?.missingAssets?.length ? (
          <div className="grid gap-3 rounded-xl border p-4">
            <p className="text-sm">
              This package is missing {selected.missingAssets.length} assets.
              Recover a local copy with the available content. Complete saving
              and export stay blocked until the missing assets are restored.
            </p>
            <Button
              variant={recover ? 'secondary' : 'outline'}
              aria-pressed={recover}
              onClick={() => setRecover(!recover)}
            >
              {recover ? 'Recovery selected' : 'Recover available content'}
            </Button>
          </div>
        ) : null}
        {review && savesDocument && (
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm">
              {mode === 'copy' ? 'Copy name' : 'Document name'}
              <Input
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
                maxLength={1000}
              />
            </label>
            <fieldset className="grid gap-2" disabled={pending}>
              <legend className="mb-2 text-sm font-medium">Save to</legend>
              {providers.map((item) => (
                <Button
                  key={item.id}
                  variant={providerId === item.id ? 'secondary' : 'outline'}
                  aria-pressed={providerId === item.id}
                  onClick={() => setProviderId(item.id)}
                  className="h-auto justify-start gap-3 rounded-xl p-4 whitespace-normal text-left"
                >
                  <item.icon />
                  <span className="grid gap-1">
                    <span>{item.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  {providerId === item.id && <CheckIcon className="ml-auto" />}
                </Button>
              ))}
            </fieldset>
            {mode === 'open' && (
              <p className="text-xs text-muted-foreground">
                A new document will be saved here. The original file stays
                unchanged.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {review && (
            <Button
              disabled={
                pending ||
                reading ||
                (Boolean(selected?.missingAssets?.length) && !recover) ||
                (savesDocument && (!provider || !name.trim())) ||
                (mode === 'copy' && !source)
              }
              onClick={() => void confirm()}
            >
              {pending
                ? mode === 'copy'
                  ? 'Saving…'
                  : mode === 'import'
                    ? 'Importing…'
                    : 'Opening…'
                : mode === 'copy'
                  ? 'Save copy'
                  : mode === 'import'
                    ? 'Import document'
                    : 'Open document'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
