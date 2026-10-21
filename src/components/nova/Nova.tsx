import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { editorExtension } from './editor'
import { NovaContentEditable } from './NovaContentEditable'
import { useState } from 'react'
import { DragPlugin } from './plugins/DragPlugin/DragPlugin'
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin/SlashMenuPlugin'
import { FloatingTextFormatToolbarPlugin } from './plugins/FormatToolbarPlugin'

export function Nova() {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)

  return (
    <LexicalExtensionComposer
      extension={editorExtension}
      contentEditable={null}
    >
      <div className="relative size-full" ref={setAnchorElement}>
        <NovaContentEditable />

        <SlashMenuPlugin />
        {anchorElement && <DragPlugin anchorElement={anchorElement} />}
        <FloatingTextFormatToolbarPlugin />
      </div>
    </LexicalExtensionComposer>
  )
}
