import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { documentStorage } from '#/lib/documents/document-storage'
import { documentHash } from '#/lib/documents/document-url'
import type {
  DocumentChange,
  DocumentInfo,
  DocumentStorage,
} from '#/lib/documents/storage'

export function useDocuments(
  id?: string,
  storage: DocumentStorage = documentStorage,
) {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<Array<DocumentInfo>>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [lookupRevision, setLookupRevision] = useState(0)
  const createPending = useRef(false)
  const deletePending = useRef(new Set<string>())
  const document = documents.find((item) => item.id === id)
  const hasDocument = Boolean(document)
  const lookupTarget = useRef<
    { id: string; storage: DocumentStorage } | undefined
  >(undefined)
  const [lookup, setLookup] = useState<{
    id: string
    pending: boolean
    error?: string
  }>()
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
        if (!deletePending.current.has(change.id)) {
          if (change.id === activeId.current) void navigate({ to: '/' })
        }
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

  useEffect(() => {
    if (!id || !loaded || error) return
    if (
      lookupTarget.current?.id === id &&
      lookupTarget.current.storage === storage
    )
      return
    lookupTarget.current = { id, storage }
    if (hasDocument) {
      setLookup({ id, pending: false })
      return
    }
    let active = true
    setLookup({ id, pending: true })
    void storage
      .get(id)
      .then((found) => {
        if (!active) return
        if (found)
          setDocuments((items) =>
            items.some((item) => item.id === found.id)
              ? items
              : [...items, found].sort((a, b) => b.updatedAt - a.updatedAt),
          )
        setLookup({ id, pending: false })
      })
      .catch((cause: unknown) => {
        if (!active) return
        const missing =
          typeof cause === 'object' &&
          cause !== null &&
          'status' in cause &&
          cause.status === 404
        setLookup({
          id,
          pending: false,
          error: missing
            ? undefined
            : cause instanceof Error
              ? cause.message
              : 'Could not open this document.',
        })
      })
    return () => {
      active = false
    }
  }, [id, loaded, error, storage, hasDocument, lookupRevision])

  const createDocument = useCallback(async () => {
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
      await navigate({ to: '/', hash: documentHash(created.id) })
    } catch {
      setError('Could not create the document. Please try again.')
    } finally {
      createPending.current = false
      setCreating(false)
    }
  }, [storage, navigate])

  async function renameDocumentById(documentId: string, name: string) {
    const target = documents.find((item) => item.id === documentId)
    const trimmedName = name.trim()
    if (!target || !trimmedName || target.readOnly || target.drive?.readOnly)
      return false
    if (trimmedName === target.name) return true
    try {
      const updated = await storage.rename(documentId, trimmedName)
      setDocuments((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      )
      setError('')
    } catch {
      setError('')
      toast.error('Could not save the document name. Please try again.', {
        id: `drive-rename:${documentId}`,
      })
      return false
    }
    return true
  }

  async function renameDocument(name: string) {
    if (document && !document.readOnly && !document.drive?.readOnly)
      await renameDocumentById(document.id, name)
  }

  async function deleteDocument(documentId: string) {
    deletePending.current.add(documentId)
    try {
      await storage.delete(documentId)
      setDocuments((items) => items.filter((item) => item.id !== documentId))
      setError('')
      if (documentId === id) await navigate({ to: '/' })
    } catch {
      setError('Could not delete the document. Please try again.')
    } finally {
      deletePending.current.delete(documentId)
    }
  }

  return {
    retryOpen: () => {
      lookupTarget.current = undefined
      setLookupRevision((value) => value + 1)
    },
    documents,
    document,
    loaded:
      loaded &&
      (Boolean(error) ||
        !id ||
        hasDocument ||
        (lookup?.id === id && !lookup.pending)),
    error:
      error ||
      (!hasDocument && lookup && lookup.id === id ? (lookup.error ?? '') : ''),
    creating,
    createDocument,
    renameDocument,
    renameDocumentById,
    deleteDocument,
  }
}
