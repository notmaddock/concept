import { Nova } from '#/components/nova/Nova'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/nova/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <main className="h-screen flex flex-col items-center p-4">
      <section className="flex-1 flex flex-col w-full max-w-4xl border rounded-sm bg-popover overflow-hidden">
        <Nova />
      </section>
    </main>
  )
}
