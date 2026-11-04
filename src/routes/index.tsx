import { createFileRoute, useLocation } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'
import { DocumentLoading } from '#/components/documents/DocumentLoading'
import { documentIdFromHash } from '#/lib/documents/document-url'

export const Route = createFileRoute('/')({ component: DocumentRoute })

const subscribeToHydration = () => () => {}

function DocumentRoute() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  )
  const hash = useLocation({ select: (location) => location.hash })
  // URL fragments never reach the server; defer workspace effects until the client resolves one.
  if (!hydrated) return <DocumentLoading label="Loading documents…" />
  return <DocumentWorkspace id={documentIdFromHash(hash)} />
}
