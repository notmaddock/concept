import { observeDocumentTheme } from '#/lib/documents/document-theme'
import type { DocumentTheme } from '#/lib/documents/document-theme'
import type { RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import type {
  DocumentPersistence,
  DocumentSyncStatus,
} from '#/lib/documents/storage'
import { useEffect, useState } from 'react'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { Doc } from 'yjs'
import { DocumentLoading } from './DocumentLoading'
import { Nova } from '#/components/nova/Nova'
import { initializeDocument } from '#/lib/documents/initial-document'
import { LocalProvider } from '#/lib/documents/local-provider'
import { workspaceDocumentStorage } from '#/lib/documents/workspace-storage'

export function DocumentEditor({
  documentRef,
  id,
  pageSetupOpen,
  editorRef,
  onPageSetupOpenChange,
  onDocumentThemeChange,
  onSyncStatusChange,
}: {
  onSyncStatusChange?: (status: DocumentSyncStatus, retry?: () => void) => void
  onDocumentThemeChange?: (theme: DocumentTheme) => void
  documentRef: RefObject<Doc | null>
  id: string
  editorRef?: RefObject<LexicalEditor | null>
  pageSetupOpen: boolean
  onPageSetupOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<{
    doc: Doc
    provider: LocalProvider
  } | null>(null)

  useEffect(() => {
    const startedAt = performance.now()
    let active = true
    const doc = new Doc()
    let persistence: DocumentPersistence | undefined
    let stopStatus: (() => void) | undefined
    let stopTheme: (() => void) | undefined
    // Lexical must observe the Yjs root before IndexedDB applies existing content.
    const provider = new LocalProvider(
      id,
      doc,
      () => {
        persistence = workspaceDocumentStorage.open(id, doc)
        stopStatus = persistence.subscribeStatus?.((status) => {
          if (active) onSyncStatusChange?.(status, persistence?.retrySync)
        })
        void persistence.whenSynced.catch(() => {
          if (active)
            setError(
              'Could not open this document. It may have been deleted in another tab.',
            )
        })
        return persistence
      },
      initializeDocument,
    )
    const onSync = (synced: boolean) => {
      if (!active || !synced) return
      stopTheme ??= observeDocumentTheme(doc, onDocumentThemeChange)
      performance.measure('concept:document-storage', { start: startedAt })
      documentRef.current = doc
      setReady(true)
    }
    provider.on('sync', onSync)
    setSession({ doc, provider })
    return () => {
      active = false
      stopTheme?.()
      stopStatus?.()
      documentRef.current = null
      provider.off('sync', onSync)
      provider.destroy()
      void (persistence?.destroy() ?? Promise.resolve()).finally(() =>
        doc.destroy(),
      )
    }
  }, [id, documentRef, onDocumentThemeChange, onSyncStatusChange])

  if (error)
    return (
      <p role="alert" className="p-8 text-destructive">
        {error}
      </p>
    )

  if (!session) return <DocumentLoading />

  return (
    <>
      {!ready && <DocumentLoading />}
      <div className={ready ? 'contents' : 'hidden'}>
        <LexicalCollaboration>
          <Nova
            editorRef={editorRef}
            pageSetupOpen={pageSetupOpen}
            onPageSetupOpenChange={onPageSetupOpenChange}
            collaboration={
              <CollaborationPlugin
                id={id}
                providerFactory={(_, documents) => {
                  documents.set(id, session.doc)
                  return session.provider
                }}
                shouldBootstrap={false}
              />
            }
          />
        </LexicalCollaboration>
      </div>
    </>
  )
}
