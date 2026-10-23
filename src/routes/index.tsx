import { AccountManager } from '#/components/account/AccountManager'
import { Button } from '#/components/ui/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="relative flex min-h-svh w-full flex-col items-center justify-center gap-4 p-4">
      <div className="absolute right-4 top-4">
        <AccountManager />
      </div>
      <h1 className="text-4xl text-primary">Welcome to Concept (beta)</h1>

      <Button nativeButton={false} render={<Link to="/new" />} size={'lg'}>
        <PlusIcon /> New document
      </Button>
    </main>
  )
}
