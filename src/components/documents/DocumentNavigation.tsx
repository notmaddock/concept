import { DocumentFileMenu } from './navigation-menus/DocumentFileMenu'
import { DocumentViewMenu } from './navigation-menus/DocumentViewMenu'
import {
  documentMenuContentClassName,
  documentMenuTriggerClassName,
} from './navigation-menus/menu-styles'
import {
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger,
} from '#/components/ui/menubar'

export function DocumentNavigation({
  onPageSetup,
  onCreate,
  creating,
  enabled,
}: {
  onPageSetup: () => void
  onCreate: () => Promise<void>
  creating: boolean
  enabled: boolean
}) {
  return (
    <Menubar
      aria-label="Editor menu"
      className="h-auto min-h-7 max-w-full flex-wrap gap-0 border-0 p-0"
    >
      <DocumentFileMenu
        onPageSetup={onPageSetup}
        onCreate={onCreate}
        creating={creating}
        disabled={!enabled}
      />
      {['Edit', 'View', 'Insert', 'Format', 'Tools', 'Help'].map((label) =>
        label === 'View' ? (
          <DocumentViewMenu key={label} disabled={!enabled} />
        ) : (
          <MenubarMenu key={label}>
            <MenubarTrigger
              disabled={!enabled}
              className={documentMenuTriggerClassName}
            >
              {label}
            </MenubarTrigger>
            <MenubarContent
              className={documentMenuContentClassName}
              alignOffset={0}
              sideOffset={4}
            >
              <p className="px-2 py-1 text-sm text-muted-foreground">
                No options yet
              </p>
            </MenubarContent>
          </MenubarMenu>
        ),
      )}
    </Menubar>
  )
}
