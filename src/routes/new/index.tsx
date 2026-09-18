import { Editor } from '#/components/editor/Editor'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="overflow-hidden border border-green-800 fixed inset-0 p-4">
      <div className="bg-popover shadow-xs border rounded-sm max-w-4xl mx-auto h-full">
        <Editor />
      </div>
    </div>
  )
}
