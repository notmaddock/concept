import { useState } from 'react'
import {
  FingerprintIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
} from 'lucide-react'
import { AccountAvatar, AccountIdentity } from './AccountIdentity'
import type { AccountUser } from './AccountIdentity'
import { useTheme } from '#/components/theme-provider'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export function AccountMenu({
  user,
  onSettings,
  onSignOut,
  onGoogle,
  onPasskey,
  busy,
  signInMethod,
}: {
  user?: AccountUser
  onSettings: () => void
  onSignOut: () => void
  onGoogle: () => void
  onPasskey: () => void
  busy: boolean
  signInMethod: 'google' | 'passkey' | null
}) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ThemeIcon =
    theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account menu"
          />
        }
      >
        <AccountAvatar user={user} className="size-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="px-3 py-3">
          <AccountIdentity user={user} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {user ? (
            <DropdownMenuItem onClick={onSettings}>
              <Settings2Icon /> Account settings
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                closeOnClick={false}
                disabled={busy}
                aria-busy={signInMethod === 'google'}
                onClick={onGoogle}
              >
                {signInMethod === 'google' ? (
                  <LoaderCircleIcon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <img src="/icons/google.png" alt="" className="size-4" />
                )}{' '}
                Sign in with Google
              </DropdownMenuItem>
              <DropdownMenuItem
                closeOnClick={false}
                disabled={busy}
                aria-busy={signInMethod === 'passkey'}
                onClick={onPasskey}
              >
                {signInMethod === 'passkey' ? (
                  <LoaderCircleIcon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <FingerprintIcon />
                )}{' '}
                Sign in with passkey
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ThemeIcon /> Theme{' '}
              <span className="ml-auto text-xs capitalize text-muted-foreground">
                {theme}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (
                    value === 'light' ||
                    value === 'dark' ||
                    value === 'system'
                  )
                    setTheme(value)
                }}
              >
                <DropdownMenuRadioItem value="light">
                  <SunIcon />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <MoonIcon />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <MonitorIcon />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOutIcon /> Log out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
