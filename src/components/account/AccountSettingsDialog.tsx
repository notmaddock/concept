import { ChevronDownIcon, KeyRoundIcon, PlugIcon } from 'lucide-react'
import { AccountIdentity } from './AccountIdentity'
import { SignInSettings } from './SignInSettings'
import { StorageConnections } from './StorageConnections'
import type { useAccountSettings } from './use-account-settings'
import { Button } from '#/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
} from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#/components/ui/dialog'

export function AccountSettingsDialog({
  settings,
}: {
  settings: ReturnType<typeof useAccountSettings>
}) {
  const { section, setSection } = settings
  const user = settings.session?.user
  if (!user) return null
  const sections = [
    { id: 'sign-in', label: 'Sign in', icon: KeyRoundIcon },
    { id: 'connections', label: 'Connections', icon: PlugIcon },
  ] as const
  return (
    <Dialog open={settings.open} onOpenChange={settings.setOpen}>
      <DialogContent className="flex h-[480px] max-h-[calc(100svh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Account settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your sign-in methods and storage connections.
        </DialogDescription>
        <SidebarProvider className="min-h-0 items-stretch">
          <Sidebar
            collapsible="none"
            className="hidden h-auto w-60 shrink-0 border-r sm:flex"
          >
            <SidebarHeader className="px-4 py-5">
              <AccountIdentity user={user} />
            </SidebarHeader>
            <SidebarContent className="px-3 pb-3">
              <nav aria-label="Account settings" className="grid gap-1">
                {sections.map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    variant={section === id ? 'secondary' : 'ghost'}
                    className="justify-start"
                    aria-current={section === id ? 'page' : undefined}
                    onClick={() => setSection(id)}
                  >
                    <Icon />
                    {label}
                  </Button>
                ))}
              </nav>
            </SidebarContent>
          </Sidebar>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-b px-4 py-3 pr-14 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Settings section"
                    />
                  }
                >
                  {sections.find((item) => item.id === section)?.label}
                  <ChevronDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {sections.map(({ id, label, icon: Icon }) => (
                    <DropdownMenuItem key={id} onClick={() => setSection(id)}>
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-6 sm:pt-8">
              {section === 'sign-in' ? (
                <SignInSettings
                  accounts={settings.accounts}
                  loading={settings.loading}
                  busy={settings.busy}
                  onGoogle={() => void settings.connect([])}
                  onUnlink={() => void settings.unlinkGoogle()}
                />
              ) : (
                <StorageConnections
                  accounts={settings.accounts}
                  loading={settings.loading}
                  busy={settings.busy}
                  error={settings.error}
                  onRetry={settings.reload}
                  onConnect={(scopes) => void settings.connect(scopes)}
                  onDisconnect={() => void settings.disconnectDrive()}
                />
              )}
            </div>
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
