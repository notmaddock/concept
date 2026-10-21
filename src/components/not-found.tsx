import { Link } from '@tanstack/react-router'
import { FileQuestion, Home, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="flex flex-col items-center max-w-md space-y-5">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted border border-border shadow-xs text-muted-foreground">
          <FileQuestion className="size-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground tracking-tight">
            Page not found
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
            The document or page you are looking for doesn&apos;t exist or has
            been moved.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button
            nativeButton={false}
            render={<Link to="/" />}
            variant="outline"
            size="default"
          >
            <Home className="size-4" />
            Go to home
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/new" />}
            size="default"
          >
            <Plus className="size-4" />
            New document
          </Button>
        </div>
      </div>
    </main>
  )
}
