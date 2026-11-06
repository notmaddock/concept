import '#/styles/editor.css'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import { PageSetupPlugin } from '#/components/documents/page-setup/PageSetupPlugin'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { collaborativeEditorExtension, editorExtension } from './editor'
import { NovaContentEditable } from './NovaContentEditable'
import { useEffect, useState } from 'react'
import { DragPlugin } from './plugins/DragPlugin/DragPlugin'
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin/SlashMenuPlugin'
import { FloatingTextFormatToolbarPlugin } from './plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin'
import { ImagePlugin } from './images/ImagePlugin'
import { ImageClipboardPlugin } from './clipboard/ImageClipboardPlugin'
import type { EditorMode } from './mode'

export type { EditorMode } from './mode'

function EditorModePlugin({ mode }: { mode: EditorMode }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.setEditable(mode === 'edit')
  }, [editor, mode])
  return null
}

export function Nova({
  collaboration,
  editorRef,
  mode = 'edit',
  pageSetupOpen = false,
  onPageSetupOpenChange = () => {},
}: {
  editorRef?: RefObject<LexicalEditor | null>
  collaboration?: React.ReactNode
  mode?: EditorMode
  pageSetupOpen?: boolean
  onPageSetupOpenChange?: (open: boolean) => void
}) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)
  const isEditable = mode === 'edit'

  return (
    <LexicalExtensionComposer
      extension={collaboration ? collaborativeEditorExtension : editorExtension}
      contentEditable={null}
    >
      <EditorModePlugin mode={mode} />
      <ImagePlugin />
      <ImageClipboardPlugin />
      {editorRef && <EditorRefPlugin editorRef={editorRef} />}
      <div className="relative min-h-full w-full grow" ref={setAnchorElement}>
        <NovaContentEditable />
        {collaboration}
        <PageSetupPlugin
          open={isEditable && pageSetupOpen}
          onOpenChange={onPageSetupOpenChange}
        />

        {isEditable && <SlashMenuPlugin />}
        {isEditable && anchorElement && (
          <DragPlugin anchorElement={anchorElement} />
        )}
        {isEditable && <FloatingTextFormatToolbarPlugin />}
      </div>
    </LexicalExtensionComposer>
  )
}
