import '#/styles/editor.css'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import type { RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import { PageSetupPlugin } from '#/components/documents/page-setup/PageSetupPlugin'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { collaborativeEditorExtension, editorExtension } from './editor'
import { NovaContentEditable } from './NovaContentEditable'
import { useState } from 'react'
import { DragPlugin } from './plugins/DragPlugin/DragPlugin'
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin/SlashMenuPlugin'
import { FloatingTextFormatToolbarPlugin } from './plugins/FormatToolbarPlugin'

export function Nova({
  collaboration,
  editorRef,
  pageSetupOpen = false,
  onPageSetupOpenChange = () => {},
}: {
  editorRef?: RefObject<LexicalEditor | null>
  collaboration?: React.ReactNode
  pageSetupOpen?: boolean
  onPageSetupOpenChange?: (open: boolean) => void
}) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)

  return (
    <LexicalExtensionComposer
      extension={collaboration ? collaborativeEditorExtension : editorExtension}
      contentEditable={null}
    >
      {editorRef && <EditorRefPlugin editorRef={editorRef} />}
      <div className="relative min-h-full w-full grow" ref={setAnchorElement}>
        <NovaContentEditable />
        {collaboration}
        <PageSetupPlugin
          open={pageSetupOpen}
          onOpenChange={onPageSetupOpenChange}
        />

        <SlashMenuPlugin />
        {anchorElement && <DragPlugin anchorElement={anchorElement} />}
        <FloatingTextFormatToolbarPlugin />
      </div>
    </LexicalExtensionComposer>
  )
}
