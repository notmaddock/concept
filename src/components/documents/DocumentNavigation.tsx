import { useState } from 'react'
import { useDocumentWorkspace } from './document-workspace-context'
import EditorDocumentNavigation from './EditorDocumentNavigation'
import { DocumentActionSearch } from './DocumentActionSearch'
import { DocumentMenu } from './navigation-menus/DocumentMenu'
import { useDocumentNavigationOptions } from './navigation-menus/document-navigation-options'
import { Menubar } from '#/components/ui/menubar'
import type { NavigationActions } from './navigation-menus/document-navigation-options'
import { KeyboardShortcutsDialog } from './dialogs/KeyboardShortcutsDialog'

export function DocumentNavigation() {
  const { document } = useDocumentWorkspace()
  if (!document) return <DocumentNavigationContent />
  return <EditorDocumentNavigation />
}

export function DocumentNavigationContent({
  actions,
}: {
  actions?: NavigationActions
}) {
  const [menuState, setMenuState] = useState<{
    label: string | null
    instant: boolean
  }>({ label: null, instant: false })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const { enabled } = useDocumentWorkspace()
  const { menus, options } = useDocumentNavigationOptions(actions, {
    onShowKeyboardShortcuts: () => setShortcutsOpen(true),
  })

  return (
    <>
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
              if (enabled || menu.label === 'File' || menu.label === 'Help') {
                setMenuState((current) =>
                  current.label === null || current.label === menu.label
                    ? current
                    : { label: menu.label, instant: true },
                )
              }
            }}
            disabled={
              !enabled && menu.label !== 'File' && menu.label !== 'Help'
            }
            {...menu}
          />
        ))}
      </Menubar>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </>
  )
}
