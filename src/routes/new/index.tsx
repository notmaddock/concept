import { Editor } from '#/components/editor/Editor'
import { ModeToggle } from '#/components/mode-toggle'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="overflow-hidden fixed inset-0 p-4">
      <div className="bg-popover shadow-xs border rounded-sm max-w-4xl mx-auto h-full relative">
        <div className="absolute top-3 right-3 z-10">
          <ModeToggle />
        </div>
        <Editor />
      </div>
    </div>
  )
}
