import { useEffect, useRef } from 'react'
import { useDocuments } from '#/hooks/use-documents'
import { Button } from '#/components/ui/button'
import { DocumentLoading } from './DocumentLoading'

export function NewDocument() {
  const { createDocument, creating, error } = useDocuments()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void createDocument({ replace: true })
  }, [createDocument])

  if (error) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{error}</p>
        <Button
          onClick={() => void createDocument({ replace: true })}
          disabled={creating}
        >
          Try again
        </Button>
      </main>
    )
  }

  return <DocumentLoading label="Creating document…" />
}
