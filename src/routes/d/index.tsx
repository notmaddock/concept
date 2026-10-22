import { createFileRoute } from '@tanstack/react-router'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'

export const Route = createFileRoute('/d/')({ component: DocumentWorkspace })
