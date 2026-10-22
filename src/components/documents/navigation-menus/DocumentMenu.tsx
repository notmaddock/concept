import { Fragment } from 'react'
import type { NavigationMenuItem } from './document-navigation-options'
import {
  documentMenuContentClassName,
  documentMenuItemClassName,
  documentMenuTriggerClassName,
  documentSubmenuContentClassName,
} from './menu-styles'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

function MenuItems({ items }: { items: NavigationMenuItem[] }) {
  const selected = items.find((item) => 'checked' in item && item.checked)
  const content = items.map((item) => {
    const Icon = item.icon
    if ('children' in item) {
      return (
        <DropdownMenuSub key={item.id}>
          <DropdownMenuSubTrigger className={documentMenuItemClassName}>
            <Icon /> {item.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            side="right"
            align="start"
            alignOffset={-4}
            sideOffset={4}
            className={documentSubmenuContentClassName}
          >
            <MenuItems items={item.children} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }

    return (
      <Fragment key={item.id}>
        {item.separatorBefore && <DropdownMenuSeparator />}
        {item.checked !== undefined ? (
          <DropdownMenuRadioItem
            className={documentMenuItemClassName}
            value={item.id}
            disabled={item.disabled}
          >
            <Icon /> {item.menuLabel ?? item.label}
          </DropdownMenuRadioItem>
        ) : (
          <DropdownMenuItem
            className={documentMenuItemClassName}
            onClick={item.onSelect}
            disabled={item.disabled}
          >
            <Icon /> {item.menuLabel ?? item.label}
          </DropdownMenuItem>
        )}
      </Fragment>
    )
  })

  return items.some(
    (item) => 'checked' in item && item.checked !== undefined,
  ) ? (
    <DropdownMenuRadioGroup
      value={selected?.id}
      onValueChange={(value) => {
        const item = items.find((option) => option.id === value)
        if (item && !('children' in item)) void item.onSelect()
      }}
    >
      {content}
    </DropdownMenuRadioGroup>
  ) : (
    content
  )
}

export function DocumentMenu({
  disabled,
  label,
  items,
}: {
  disabled: boolean
  label: string
  items: NavigationMenuItem[]
}) {
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
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={documentMenuContentClassName}
      >
        {items.length > 0 ? (
          <MenuItems items={items} />
        ) : (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            No options yet
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
