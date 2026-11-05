import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftIcon, FolderIcon } from 'lucide-react'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { DocumentInfo, DocumentPersistence } from '#/lib/documents/storage'
import type { DriveFileVersion } from '#/lib/documents/drive/api'
import {
  connectGoogleDrive,
  isGoogleDriveConnected,
  isGoogleDriveAuthError,
  isGoogleDriveConfigured,
  prepareGoogleDriveAuth,
} from '#/lib/documents/drive/auth'
import {
  createConceptFile,
  DriveCreatedFileError,
  getFileMetadata,
  listFolders,
} from '#/lib/documents/drive/api'
import { documentRevision } from '#/lib/documents/revision'
import { serializeConcept } from '#/lib/documents/serialization'
import { localDocumentStorage } from '#/lib/documents/storage'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export function SaveToDriveDialog({
  source,
  onClose,
  onSaved,
}: {
  source: { name: string; doc: Doc }
  onClose: () => void
  onSaved: (info: DocumentInfo) => void
}) {
  const [name, setName] = useState(source.name)
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(false)
  const [createdFileId, setCreatedFileId] = useState<string>()
  const [path, setPath] = useState([{ id: 'root', name: 'My Drive' }])
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const saved = useRef<{
    remote: DriveFileVersion
    doc: Doc
    name: string
    content: string
  } | null>(null)
  const folder = path[path.length - 1]

  useEffect(() => {
    let active = true
    if (isGoogleDriveConfigured())
      void prepareGoogleDriveAuth()
        .then(() => {
          if (active) {
            setConnected(isGoogleDriveConnected())
            if (!isGoogleDriveConfigured())
              toast.error('Google Drive is not configured.', {
                id: 'save-to-drive',
              })
          }
        })
        .catch((cause: unknown) => {
          if (active) toast.error(message(cause), { id: 'save-to-drive' })
        })
    setConnected(isGoogleDriveConnected())
    return () => {
      active = false
      saved.current?.doc.destroy()
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    let active = true
    setLoading(true)
    setFolders([])
    void listFolders(folder.id)
      .then((items) => {
        if (active) setFolders(items)
      })
      .catch((cause: unknown) => {
        if (!active) return
        toast.error(message(cause), { id: 'save-to-drive' })
        if (isGoogleDriveAuthError(cause)) setConnected(false)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [connected, folder.id])

  async function connect() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await connectGoogleDrive()
      setConnected(isGoogleDriveConnected())
    } catch (cause) {
      toast.error(message(cause), { id: 'save-to-drive' })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  async function save() {
    if (pendingRef.current || !name.trim()) return
    pendingRef.current = true
    setPending(true)
    let clone: Doc | undefined
    let serialized: string | undefined
    let session: DocumentPersistence | undefined
    try {
      if (!saved.current) {
        clone = new Doc()
        applyUpdate(clone, encodeStateAsUpdate(source.doc))
        const documentName = name.trim()
        clone.getMap<string>('metadata').set('name', documentName)
        serialized = serializeConcept(documentName, clone)
        const remote = await createConceptFile(
          documentName,
          serialized,
          folder.id,
        )
        saved.current = {
          remote,
          doc: clone,
          name: documentName,
          content: serialized,
        }
        setCreated(true)
        setCreatedFileId(remote.file.id)
        clone = undefined
      }
      const { remote, doc, name: documentName, content } = saved.current
      if (!remote.etag) {
        const metadata = await getFileMetadata(remote.file.id)
        remote.etag = metadata.etag
      }
      const savedRevision = await documentRevision(content)
      const now = Date.now()
      const info: DocumentInfo = {
        id: `G${remote.file.id}`,
        name: documentName,
        updatedAt: now,
        drive: {
          fileId: remote.file.id,
          offlineAvailable: false,
          etag: remote.etag,
          revision: remote.file.headRevisionId ?? remote.file.version,
          lastSyncedAt: now,
          savedRevision,
          remoteFilename: remote.file.name || undefined,
          dirty: false,
        },
      }
      await localDocumentStorage.put(info)
      session = localDocumentStorage.open(info.id, doc)
      await session.whenSynced
      await session.flush?.()
      await session.destroy()
      session = undefined
      onSaved(info)
    } catch (cause) {
      if (
        cause instanceof DriveCreatedFileError &&
        clone &&
        serialized !== undefined
      ) {
        saved.current = {
          remote: { file: cause.file, etag: '' },
          doc: clone,
          name: name.trim(),
          content: serialized,
        }
        clone = undefined
        setCreated(true)
        setCreatedFileId(cause.file.id)
      }
      toast.error(message(cause), { id: 'save-to-drive' })
      if (isGoogleDriveAuthError(cause)) setConnected(false)
    } finally {
      await session?.destroy()
      clone?.destroy()
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
      <DialogContent aria-describedby={undefined} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Save to Google Drive</DialogTitle>
        </DialogHeader>
        <label className="grid gap-2">
          Document name
          <Input
            value={name}
            maxLength={1000}
            disabled={pending || created}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {connected ? (
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {path.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Parent folder"
                  disabled={pending || created}
                  onClick={() => setPath((items) => items.slice(0, -1))}
                >
                  <ArrowLeftIcon />
                </Button>
              )}
              <FolderIcon className="size-4 shrink-0" />
              <span className="truncate">
                {path.map((item) => item.name).join(' / ')}
              </span>
            </div>
            <div
              aria-label="Google Drive folders"
              className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border p-2"
            >
              {loading ? (
                <p role="status" className="p-2 text-muted-foreground">
                  Loading folders…
                </p>
              ) : (
                folders.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className="justify-start"
                    disabled={pending || created}
                    onClick={() => setPath((items) => [...items, item])}
                  >
                    <FolderIcon /> <span className="truncate">{item.name}</span>
                  </Button>
                ))
              )}
              {!loading && !folders.length && (
                <p className="p-2 text-muted-foreground">
                  No accessible subfolders
                </p>
              )}
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={pending || !isGoogleDriveConfigured()}
            onClick={() => void connect()}
          >
            {pending ? 'Connecting…' : 'Connect Google Drive'}
          </Button>
        )}
        {createdFileId && (
          <a
            href={`https://drive.google.com/file/d/${encodeURIComponent(createdFileId)}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4"
          >
            Open saved file in Drive
          </a>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !connected || !name.trim()}
            onClick={() => void save()}
          >
            {pending
              ? 'Saving…'
              : created
                ? 'Open saved document'
                : `Save in ${folder.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'Could not save to Google Drive.'
}
