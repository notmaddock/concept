import { Nova } from '#/components/nova/Nova'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Nova />
}
