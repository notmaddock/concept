import { UserRoundIcon } from 'lucide-react'
import { cn } from '#/lib/utils'

export type AccountUser = { name: string; email: string; image?: string | null }

export function AccountAvatar({
  user,
  className,
}: {
  user?: AccountUser
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground ring-1 ring-border/60',
        className,
      )}
    >
      {user?.image ? (
        <img
          src={user.image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        <UserRoundIcon className="size-4" />
      )}
    </span>
  )
}

export function AccountIdentity({ user }: { user?: AccountUser }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountAvatar user={user} className="size-10" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {user?.name ?? 'Local workspace'}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {user?.email ?? 'Not signed in'}
        </p>
      </div>
    </div>
  )
}
