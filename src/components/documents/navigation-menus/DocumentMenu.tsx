import { ActionShortcut } from './ActionShortcut'
import { Fragment, useRef } from 'react'
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

function MenuItems({
  items,
  onEditorAction,
}: {
  items: NavigationMenuItem[]
  onEditorAction: () => void
}) {
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
            <MenuItems items={item.children} onEditorAction={onEditorAction} />
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
            onClick={() => {
              if (item.focusAfterSelect === 'editor') onEditorAction()
              void item.onSelect()
            }}
            disabled={item.disabled}
          >
            <Icon /> {item.menuLabel ?? item.label}
            <ActionShortcut shortcut={item.shortcut} />
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
  open,
  instant,
  restoreFocus,
  onOpenChange,
  onMouseEnter,
  label,
  items,
}: {
  disabled: boolean
  open: boolean
  instant: boolean
  restoreFocus: boolean
  onOpenChange: (open: boolean) => void
  onMouseEnter: () => void
  label: string
  items: NavigationMenuItem[]
}) {
  const editorAction = useRef(false)
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) editorAction.current = false
        onOpenChange(nextOpen)
      }}
    >
      <DropdownMenuTrigger
        openOnHover={false}
        onMouseEnter={onMouseEnter}
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
        // Returning focus during a switch can reopen the menu being closed.
        finalFocus={() => !editorAction.current && restoreFocus}
        className={`${label === 'Edit' ? 'w-80 p-1' : documentMenuContentClassName} ${instant ? 'data-open:animate-none data-closed:animate-none' : ''}`}
      >
        {items.length > 0 ? (
          <MenuItems
            items={items}
            onEditorAction={() => {
              editorAction.current = true
            }}
          />
        ) : (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            No options yet
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
