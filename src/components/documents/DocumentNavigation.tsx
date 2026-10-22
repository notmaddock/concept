import { DocumentActionSearch } from './DocumentActionSearch'
import { DocumentMenu } from './navigation-menus/DocumentMenu'
import { useDocumentNavigationOptions } from './navigation-menus/document-navigation-options'
import { Menubar } from '#/components/ui/menubar'

export function DocumentNavigation({
  onPageSetup,
  onCreate,
  creating,
  enabled,
  onFocusEditor,
}: {
  onPageSetup: () => void
  onCreate: () => Promise<void>
  creating: boolean
  enabled: boolean
  onFocusEditor: () => void
}) {
  const { menus, options } = useDocumentNavigationOptions({
    onPageSetup,
    onCreate,
    creating,
  })

  return (
    <Menubar
      aria-label="Editor menu"
      className="h-auto min-h-7 max-w-full flex-wrap gap-0 border-0 p-0"
    >
      <DocumentActionSearch
        enabled={enabled}
        options={options}
        onFocusEditor={onFocusEditor}
      />
      {menus.map((menu) => (
        <DocumentMenu key={menu.label} disabled={!enabled} {...menu} />
      ))}
    </Menubar>
  )
}
