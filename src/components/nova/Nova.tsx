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
  pageSetupOpen = false,
  onPageSetupOpenChange = () => {},
}: {
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
      <div className="relative size-full" ref={setAnchorElement}>
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
