import { useEffect, useState } from 'react'
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import { Doc } from 'yjs'
import { Nova } from '#/components/nova/Nova'
import { initializeDocument } from '#/lib/documents/initial-document'
import { LocalProvider } from '#/lib/documents/local-provider'
import { localDocumentStorage } from '#/lib/documents/storage'

export function DocumentEditor({
  id,
  pageSetupOpen,
  onPageSetupOpenChange,
}: {
  id: string
  pageSetupOpen: boolean
  onPageSetupOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState('')
  const [session, setSession] = useState<{
    doc: Doc
    provider: LocalProvider
  } | null>(null)

  useEffect(() => {
    let active = true
    const doc = new Doc()
    const persistence = localDocumentStorage.open(id, doc)
    const provider = new LocalProvider(id, doc, persistence, initializeDocument)
    setSession({ doc, provider })
    void persistence.whenSynced.catch(() => {
      provider.destroy()
      if (active)
        setError(
          'Could not open this document. It may have been deleted in another tab.',
        )
    })
    return () => {
      active = false
      provider.destroy()
      void persistence.destroy().finally(() => doc.destroy())
    }
  }, [id])

  if (error)
    return (
      <p role="alert" className="p-8 text-destructive">
        {error}
      </p>
    )

  if (!session)
    return <p className="p-8 text-muted-foreground">Opening document…</p>

  return (
    <LexicalCollaboration>
      <Nova
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
  )
}
