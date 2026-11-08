import { createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'
import { DocumentLoading } from '#/components/documents/DocumentLoading'

export const Route = createFileRoute('/d/$id')({ component: DocumentRoute })

const subscribeToHydration = () => () => {}

function DocumentRoute() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  )
  const { id } = Route.useParams()
  if (!hydrated) return <DocumentLoading />
  return <DocumentWorkspace id={id} />
}
