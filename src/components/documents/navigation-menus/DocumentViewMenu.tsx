import { MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from 'lucide-react'
import {
  documentMenuContentClassName,
  documentMenuItemClassName,
  documentMenuTriggerClassName,
  documentSubmenuContentClassName,
} from './menu-styles'
import { useTheme } from '#/components/theme-provider'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export function DocumentViewMenu({ disabled }: { disabled: boolean }) {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={documentMenuTriggerClassName}
            disabled={disabled}
          />
        }
      >
        View
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={documentMenuContentClassName}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={documentMenuItemClassName}>
            <PaletteIcon /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            side="right"
            align="start"
            alignOffset={-4}
            sideOffset={4}
            className={documentSubmenuContentClassName}
          >
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (value === 'light' || value === 'dark' || value === 'system')
                  setTheme(value)
              }}
            >
              <DropdownMenuRadioItem
                className={documentMenuItemClassName}
                value="light"
              >
                <SunIcon /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                className={documentMenuItemClassName}
                value="dark"
              >
                <MoonIcon /> Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                className={documentMenuItemClassName}
                value="system"
              >
                <MonitorIcon /> System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
