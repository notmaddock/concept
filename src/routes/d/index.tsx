import { createFileRoute } from '@tanstack/react-router'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'

export const Route = createFileRoute('/d/')({
  head: () => ({
    meta: [{ title: 'Documents — Concept' }],
  }),
  component: DocumentWorkspace,
})
