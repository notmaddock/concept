import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { localDocumentStorage } from '#/lib/documents/storage'
import type {
  DocumentChange,
  DocumentInfo,
  DocumentStorage,
} from '#/lib/documents/storage'

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
  const activeId = useRef(id)
  useEffect(() => {
    activeId.current = id
  }, [id])

  useEffect(() => {
    let active = true
    let reading = false
    const changesDuringRead = new Map<string, DocumentChange>()
    const refresh = () => {
      if (reading) return
      reading = true
      changesDuringRead.clear()
      const startedAt = performance.now()
      void storage
        .list()
        .then((items) => {
          performance.measure('concept:library-read', { start: startedAt })
          if (!active) return
          const reconciled = new Map(items.map((item) => [item.id, item]))
          for (const change of changesDuringRead.values()) {
            if (change.type === 'upsert')
              reconciled.set(change.document.id, change.document)
            else reconciled.delete(change.id)
          }
          setDocuments(
            changesDuringRead.size
              ? [...reconciled.values()].sort(
                  (a, b) => b.updatedAt - a.updatedAt,
                )
              : items,
          )
          setLoaded(true)
          setError('')
        })
        .catch(() => {
          if (active) {
            setLoaded(true)
            setError(
              'Could not open local documents. Check that browser storage is available, then reload.',
            )
          }
        })
        .finally(() => {
          reading = false
          changesDuringRead.clear()
        })
    }
    const unsubscribe = storage.subscribe((change) => {
      if (reading)
        changesDuringRead.set(
          change.type === 'upsert' ? change.document.id : change.id,
          change,
        )
      if (change.type === 'upsert') {
        setDocuments((items) =>
          [
            change.document,
            ...items.filter((item) => item.id !== change.document.id),
          ].sort((a, b) => b.updatedAt - a.updatedAt),
        )
      } else {
        setDocuments((items) => items.filter((item) => item.id !== change.id))
        if (
          change.id === activeId.current &&
          !deletePending.current.has(change.id)
        )
          void navigate({ to: '/d' })
      }
    })
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [storage, navigate])

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

  async function renameDocumentById(documentId: string, name: string) {
    const target = documents.find((item) => item.id === documentId)
    const trimmedName = name.trim()
    if (!target || !trimmedName) return false
    if (trimmedName === target.name) return true
    try {
      const updated = await storage.rename(documentId, trimmedName)
      setDocuments((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      )
      setError('')
    } catch {
      setError('Could not save the document name. Please try again.')
      return false
    }
    return true
  }

  async function renameDocument(name: string) {
    return document ? renameDocumentById(document.id, name) : false
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
    renameDocumentById,
    deleteDocument,
  }
}
