import type { RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import type { DocumentPersistence } from '#/lib/documents/storage'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Doc } from 'yjs'
import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { DocumentLoading } from './status/DocumentLoading'
import { DriveIcon } from './icons/DriveIcon'
import { DocumentWorkspaceContext } from './document-workspace-store'
import { Nova } from '#/components/nova/Nova'
import {
  getSessionProfile,
  isGoogleDriveAuthError,
  isGoogleDriveConnected,
} from '#/lib/documents/drive/auth'
import { initializeDocument } from '#/lib/documents/initial-document'
import { LocalProvider } from '#/lib/documents/local-provider'
import { DocumentMediaContext } from '#/components/nova/media/document-media-context'
import type { DocumentMediaSession } from '#/components/nova/media/document-media-context'
import { insertDocumentAssets } from '#/lib/documents/asset-session'
import {
  documentSessions,
  getRealtimeProvider,
  subscribeRealtimeProviders,
} from '#/lib/documents/sync'
import { documentStorage } from '#/lib/documents/document-storage'
import { bridgeAwareness } from '#/lib/documents/realtime/awareness-bridge'

export function DocumentEditor({
  documentRef,
  id,
  pageSetupOpen,
  editorRef,
  onPageSetupOpenChange,
  onConnectDrive,
}: {
  documentRef: RefObject<Doc | null>
  id: string
  editorRef?: RefObject<LexicalEditor | null>
  pageSetupOpen: boolean
  onPageSetupOpenChange: (open: boolean) => void
  onConnectDrive?: () => void
}) {
  const workspace = useContext(DocumentWorkspaceContext)
  const [error, setError] = useState('')
  const [authError, setAuthError] = useState(false)
  const [ready, setReady] = useState(false)
  const cursorsContainerRef = useRef<HTMLDivElement | null>(null)
  const [session, setSession] = useState<{
    doc: Doc
    provider: LocalProvider
    media: DocumentMediaSession
  } | null>(null)
  const [profile, setProfile] = useState<{ name?: string; image?: string }>()
  const awarenessData = useMemo(
    () => (profile?.image ? { avatar: profile.image } : undefined),
    [profile?.image],
  )

  useEffect(() => {
    setError('')
    setAuthError(false)
    setReady(false)
    const startedAt = performance.now()
    let active = true
    const lifetime = new AbortController()
    const doc = new Doc()
    let persistence: DocumentPersistence | undefined
    // Lexical must observe the Yjs root before IndexedDB applies existing content.
    const provider = new LocalProvider(
      id,
      doc,
      () => {
        persistence = documentStorage.open(id, doc)
        void persistence.whenSynced.catch((cause: unknown) => {
          if (!active) return
          const message =
            cause instanceof Error
              ? `Could not open this document. ${cause.message}`
              : 'Could not open this document.'
          toast.error(message, { id: `document-open:${id}` })
          setAuthError(
            id.startsWith('G') &&
              (!(workspace?.driveConnected ?? isGoogleDriveConnected()) ||
                isGoogleDriveAuthError(cause)),
          )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not open this document.',
          )
        })
        return persistence
      },
      initializeDocument,
    )
    const onSync = (synced: boolean) => {
      if (!active || !synced) return
      performance.measure('concept:document-storage', { start: startedAt })
      documentRef.current = doc
      setReady(true)
    }
    provider.on('sync', onSync)
    const currentSync = () => {
      const sync = documentSessions.get(id)
      return sync?.doc === doc ? sync : undefined
    }
    const media: DocumentMediaSession = {
      documentId: id,
      doc,
      signal: lifetime.signal,
      isAlive: () => active && !doc.isDestroyed,
      canEdit: () =>
        active && Boolean(currentSync()) && !currentSync()?.isReadOnly,
      get resolver() {
        return currentSync()?.assets
      },
      flush: async () => {
        await persistence?.flush?.()
      },
      requestSave: () => currentSync()?.requestUrgentSave(),
      insert: (blobs, insert) =>
        insertDocumentAssets({
          doc,
          blobs,
          insert,
          canEdit: () => media.canEdit(),
          isAlive: () => media.isAlive(),
          signal: lifetime.signal,
          flush: () => media.flush(),
          requestSave: () => media.requestSave(),
        }),
    }
    setSession({ doc, provider, media })
    return () => {
      active = false
      lifetime.abort()
      documentRef.current = null
      provider.off('sync', onSync)
      provider.destroy()
      void (persistence?.destroy() ?? Promise.resolve()).finally(() =>
        doc.destroy(),
      )
    }
  }, [id, documentRef, workspace?.driveConnected])

  useEffect(() => {
    const connected = workspace?.driveConnected ?? isGoogleDriveConnected()
    if (!id.startsWith('G') || !connected) {
      setProfile(undefined)
      return
    }
    let active = true
    void getSessionProfile().then((next) => {
      if (active) setProfile(next)
    })
    return () => {
      active = false
    }
  }, [id, workspace?.driveConnected])

  useEffect(() => {
    if (ready && window.document.activeElement === window.document.body)
      editorRef?.current?.focus()
  }, [ready, editorRef])

  useEffect(() => {
    const editor = editorRef?.current
    if (!ready || !editor || !session) return
    let unbridge: (() => void) | undefined
    let bridged: Awareness | undefined

    const attach = () => {
      const next = getRealtimeProvider(id)?.awareness
      if (next === bridged) return
      unbridge?.()
      bridged = next
      unbridge = next
        ? bridgeAwareness(
            session.provider.awareness as unknown as Awareness,
            next,
          )
        : undefined
    }

    attach()
    const unsubscribe = subscribeRealtimeProviders(attach)
    return () => {
      unsubscribe()
      unbridge?.()
    }
  }, [ready, id, editorRef, session])

  if (error) {
    const connectDrive =
      onConnectDrive ??
      (workspace
        ? () => {
            void workspace.connectDrive()
          }
        : undefined)
    const needsDriveConnection =
      authError ||
      (id.startsWith('G') &&
        !(workspace?.driveConnected ?? isGoogleDriveConnected()))

    return (
      <Empty className="min-h-full rounded-xl bg-card p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>Could not open this document</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        {needsDriveConnection && connectDrive ? (
          <EmptyContent>
            <Button
              disabled={workspace?.driveLoading}
              onClick={() => {
                connectDrive()
              }}
            >
              <DriveIcon className="size-4" />
              Connect Google Drive
            </Button>
          </EmptyContent>
        ) : id.startsWith('G') && workspace?.openGoogleDrivePicker ? (
          <EmptyContent>
            <Button
              disabled={workspace.pickerLoading || workspace.driveLoading}
              onClick={() => {
                void workspace.openGoogleDrivePicker()
              }}
            >
              <DriveIcon className="size-4" />
              Open the Google Drive file picker
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }

  if (!session) return <DocumentLoading />

  const isReadOnly = Boolean(
    workspace?.document?.readOnly || workspace?.document?.drive?.readOnly,
  )
  const mode = isReadOnly ? 'view-only' : 'edit'

  return (
    <>
      {!ready && <DocumentLoading />}
      <div className={ready ? 'contents' : 'hidden'}>
        <DocumentMediaContext value={ready ? session.media : null}>
          <LexicalCollaboration>
            <Nova
              key={session.doc.guid}
              editorRef={editorRef}
              cursorsContainerRef={cursorsContainerRef}
              mode={mode}
              pageSetupOpen={pageSetupOpen}
              onPageSetupOpenChange={onPageSetupOpenChange}
              collaboration={
                <CollaborationPlugin
                  id={id}
                  username={profile?.name}
                  awarenessData={awarenessData}
                  providerFactory={(_, documents) => {
                    documents.set(id, session.doc)
                    return session.provider
                  }}
                  cursorsContainerRef={cursorsContainerRef}
                  selectionHighlight
                  shouldBootstrap={false}
                />
              }
            />
          </LexicalCollaboration>
        </DocumentMediaContext>
      </div>
    </>
  )
}
