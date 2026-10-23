import { NewDocument } from '#/components/documents/NewDocument'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  head: () => ({
    meta: [{ title: 'New document — Concept' }],
  }),
  component: NewDocument,
})
