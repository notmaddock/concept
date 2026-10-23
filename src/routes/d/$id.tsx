import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { DocumentWorkspace } from '#/components/documents/DocumentWorkspace'

const paramsSchema = z.object({
  id: z.uuid(),
})

export const Route = createFileRoute('/d/$id')({
  params: {
    parse: (params) => {
      const parsed = paramsSchema.safeParse(params)
      if (!parsed.success) throw notFound()
      return parsed.data
    },
    stringify: ({ id }) => ({ id }),
  },
  component: DocumentRoute,
})

function DocumentRoute() {
  const { id } = Route.useParams()
  return <DocumentWorkspace id={id} />
}
