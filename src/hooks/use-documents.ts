import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { localDocumentStorage } from '#/lib/documents/storage'
import type { DocumentInfo, DocumentStorage } from '#/lib/documents/storage'

export function useDocuments(
  id?: string,
  storage: DocumentStorage = localDocumentStorage,
) {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<Array<DocumentInfo>>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const createPending = useRef(false)
  const deletePending = useRef(new Set<string>())
  const document = documents.find((item) => item.id === id)

  useEffect(() => {
    let active = true
    let revision = 0
    const refresh = () => {
      const requestRevision = ++revision
      void storage
        .list()
        .then((items) => {
          if (active && requestRevision === revision) {
            setDocuments(items)
            setLoaded(true)
          }
        })
        .catch(() => {
          if (active)
            setError(
              'Could not open local documents. Check that browser storage is available, then reload.',
            )
        })
    }
    const unsubscribe = storage.subscribe((change) => {
      if (change.type === 'upsert') {
        setDocuments((items) =>
          [
            change.document,
            ...items.filter((item) => item.id !== change.document.id),
          ].sort((a, b) => b.updatedAt - a.updatedAt),
        )
      } else {
        setDocuments((items) => items.filter((item) => item.id !== change.id))
        if (change.id === id && !deletePending.current.has(change.id))
          void navigate({ to: '/d' })
      }
      refresh()
    })
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [storage, id, navigate])

  async function createDocument() {
    if (createPending.current) return
    createPending.current = true
    setCreating(true)
    try {
      const created = await storage.create()
      setDocuments((items) => [
        created,
        ...items.filter((item) => item.id !== created.id),
      ])
      setError('')
      await navigate({ to: '/d/$id', params: { id: created.id } })
    } catch {
      setError('Could not create the document. Please try again.')
    } finally {
      createPending.current = false
      setCreating(false)
    }
  }

  async function renameDocument(name: string) {
    if (!document || name === document.name) return
    try {
      const updated = await storage.rename(document.id, name)
      setDocuments((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      )
      setError('')
    } catch {
      setError('Could not save the document name. Please try again.')
    }
  }

  async function deleteDocument(documentId: string) {
    deletePending.current.add(documentId)
    try {
      await storage.delete(documentId)
      setDocuments((items) => items.filter((item) => item.id !== documentId))
      setError('')
      if (documentId === id) await navigate({ to: '/d' })
    } catch {
      setError('Could not delete the document. Please try again.')
    } finally {
      deletePending.current.delete(documentId)
    }
  }

  return {
    documents,
    document,
    loaded,
    error,
    creating,
    createDocument,
    renameDocument,
    deleteDocument,
  }
}
