import { useState } from 'react'
import { useDocumentWorkspace } from './document-workspace-context'
import { DocumentActionSearch } from './DocumentActionSearch'
import { DocumentMenu } from './navigation-menus/DocumentMenu'
import { useDocumentNavigationOptions } from './navigation-menus/document-navigation-options'
import { Menubar } from '#/components/ui/menubar'

export function DocumentNavigation() {
  const [menuState, setMenuState] = useState<{
    label: string | null
    instant: boolean
  }>({ label: null, instant: false })
  const { enabled } = useDocumentWorkspace()
  const { menus, options } = useDocumentNavigationOptions()

  return (
    <Menubar
      aria-label="Editor menu"
      className="h-auto min-h-7 max-w-full flex-wrap gap-0 border-0 p-0"
    >
      <DocumentActionSearch options={options} />
      {menus.map((menu) => (
        <DocumentMenu
          key={menu.label}
          open={menuState.label === menu.label}
          instant={menuState.instant}
          restoreFocus={menuState.label === null}
          onOpenChange={(open) => {
            setMenuState((current) => {
              if (open) {
                return current.label === menu.label
                  ? current
                  : { label: menu.label, instant: current.label !== null }
              }
              return current.label === menu.label
                ? { label: null, instant: false }
                : current
            })
          }}
          onMouseEnter={() => {
            if (enabled || menu.label === 'File') {
              setMenuState((current) =>
                current.label === null || current.label === menu.label
                  ? current
                  : { label: menu.label, instant: true },
              )
            }
          }}
          disabled={!enabled && menu.label !== 'File'}
          {...menu}
        />
      ))}
    </Menubar>
  )
}
