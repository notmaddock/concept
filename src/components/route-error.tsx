import { Link, useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="flex flex-col items-center max-w-md space-y-5">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted border border-border shadow-xs text-muted-foreground">
          <AlertTriangle className="size-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground tracking-tight">
            Something went wrong
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
            An unexpected error occurred while loading this page. Please try
            again.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="default"
            onClick={() => {
              reset()
              void router.invalidate()
            }}
          >
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button nativeButton={false} render={<Link to="/" />} size="default">
            <Home className="size-4" />
            Go to home
          </Button>
        </div>
      </div>
    </main>
  )
}
