import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { DocumentLoading } from './DocumentLoading'

export function DriveLaunchLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <DocumentLoading label={label} />
    </main>
  )
}

export function DriveLaunchError({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="grid max-w-md gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {children}
        <Button nativeButton={false} render={<Link to="/" />} variant="outline">
          Go to Concept
        </Button>
      </div>
    </main>
  )
}
