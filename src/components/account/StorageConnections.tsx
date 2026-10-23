import {
  EllipsisIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  UnplugIcon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { googlePermissions, hasScopes } from '#/lib/auth/connections'

export type LinkedAccount = {
  id: string
  accountId: string
  providerId: string
  scopes: Array<string>
  driveConnected?: boolean
}

export function StorageConnections({
  accounts,
  loading,
  busy,
  error,
  onRetry,
  onConnect,
  onDisconnect,
}: {
  accounts: Array<LinkedAccount>
  loading: boolean
  busy: boolean
  error: string
  onRetry: () => void
  onConnect: (scopes: ReadonlyArray<string>) => void
  onDisconnect: () => void
}) {
  const google = accounts.find((account) => account.providerId === 'google')
  const [files] = googlePermissions
  const connected =
    google?.driveConnected === true && hasScopes(google.scopes, files.scopes)
  return (
    <section className="space-y-6" aria-label="Storage connections">
      <h2 className="font-heading text-lg font-medium">Connections</h2>
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <img src="/icons/google-drive.svg" alt="" className="size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Google Drive</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading ? 'Loading…' : connected ? 'Connected' : 'Not connected'}
          </p>
        </div>
        {!connected && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading}
            onClick={() => onConnect(files.scopes)}
          >
            Connect
          </Button>
        )}
        {connected && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Google Drive options"
                  disabled={busy || loading}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => onConnect(files.scopes)}>
                <RefreshCwIcon />
                Reconnect
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a
                    href="https://myaccount.google.com/connections"
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <ExternalLinkIcon />
                Google permissions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDisconnect}>
                <UnplugIcon />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error && (
        <Button variant="outline" disabled={busy || loading} onClick={onRetry}>
          Retry connections
        </Button>
      )}
    </section>
  )
}
