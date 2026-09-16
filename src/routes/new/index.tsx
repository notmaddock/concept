import { Editor } from '#/components/editor/Editor'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <main className='fixed inset-0'>
    <Editor />
  </main>
}
