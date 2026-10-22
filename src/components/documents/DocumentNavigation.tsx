import { useDocumentWorkspace } from './document-workspace-context'
import { DocumentActionSearch } from './DocumentActionSearch'
import { DocumentMenu } from './navigation-menus/DocumentMenu'
import { useDocumentNavigationOptions } from './navigation-menus/document-navigation-options'
import { Menubar } from '#/components/ui/menubar'

export function DocumentNavigation() {
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
          disabled={!enabled && menu.label !== 'File'}
          {...menu}
        />
      ))}
    </Menubar>
  )
}
