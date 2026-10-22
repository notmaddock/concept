import { Button } from '#/components/ui/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="fixed inset-0 flex flex-col gap-4 justify-center items-center">
      <h1 className="text-4xl text-primary">Welcome to Concept (beta)</h1>

      <Button nativeButton={false} render={<Link to="/d" />} size={'lg'}>
        <PlusIcon /> New document
      </Button>
    </main>
  )
}
