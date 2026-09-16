import { Editor } from '#/components/editor/Editor'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <Editor />
    </div>
  )
}
