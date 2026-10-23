import { createFileRoute } from '@tanstack/react-router'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'

export const Route = createFileRoute('/d/$id')({ component: DocumentRoute })

function DocumentRoute() {
  const { id } = Route.useParams()
  return <DocumentWorkspace id={id} />
}
