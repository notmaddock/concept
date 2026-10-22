import { toast } from 'sonner'
import { DocumentNavigationContent } from './DocumentNavigation'
import { useDocumentWorkspace } from './document-workspace-context'
import { formatActions } from './navigation-menus/document-navigation-options'
import { useEditActions } from './navigation-menus/use-edit-actions'
import { useFormatActions } from './navigation-menus/use-format-actions'

export default function EditorDocumentNavigation() {
  const workspace = useDocumentWorkspace()
  const edit = useEditActions(
    workspace.editorRef,
    workspace.document?.id,
    (message) => toast.error(message),
  )
  const format = useFormatActions(
    workspace.editorRef,
    workspace.document?.id,
    formatActions,
  )
  return <DocumentNavigationContent actions={{ edit, format }} />
}
