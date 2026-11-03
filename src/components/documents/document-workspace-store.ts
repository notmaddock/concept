import { createContext, useContext } from 'react'
import type { DocumentWorkspaceState } from './document-workspace-context'

export const DocumentWorkspaceContext = createContext<
  DocumentWorkspaceState | undefined
>(undefined)

export function useDocumentWorkspace() {
  const context = useContext(DocumentWorkspaceContext)
  if (!context)
    throw new Error(
      'useDocumentWorkspace must be used within a DocumentWorkspaceProvider',
    )
  return context
}
