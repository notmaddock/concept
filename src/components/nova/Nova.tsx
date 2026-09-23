import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { editorExtension } from './editor'
import { NovaContentEditable } from './NovaContentEditable'
import { useState } from 'react'
import { DragPlugin } from './plugins/DragPlugin/DragPlugin'

export function Nova() {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)

  return (
    <LexicalExtensionComposer
      extension={editorExtension}
      contentEditable={null}
    >
      <div className="relative size-full" ref={setAnchorElement}>
        <NovaContentEditable />

        {anchorElement && <DragPlugin anchorElement={anchorElement} />}
      </div>
    </LexicalExtensionComposer>
  )
}
