import { SKIP_DOM_SELECTION_TAG } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { $setDocumentTheme } from '#/lib/documents/document-theme'

export function selectDocumentTheme(
  editor: LexicalEditor | null | undefined,
  id: string,
  readOnly = false,
) {
  if (readOnly || !editor) return
  editor.update(() => $setDocumentTheme(id), { tag: SKIP_DOM_SELECTION_TAG })
}
