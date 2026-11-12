import '#/styles/editor.css'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { RefCallback, RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import { PageSetupPlugin } from '#/components/documents/page-setup/PageSetupPlugin'
import { DocumentThemePlugin } from '#/components/documents/theme/DocumentThemePlugin'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { collaborativeEditorExtension, editorExtension } from './editor'
import { NovaContentEditable } from './NovaContentEditable'
import { useEffect, useState } from 'react'
import { DragPlugin } from './plugins/DragPlugin/DragPlugin'
import { SlashMenuPlugin } from './plugins/SlashMenuPlugin/SlashMenuPlugin'
import { FloatingTextFormatToolbarPlugin } from './plugins/FormatToolbarPlugin/FloatingTextFormatToolbarPlugin'
import { LinkPlugin } from './plugins/LinkPlugin/LinkPlugin'
import { CodeActionMenuPlugin } from './plugins/CodePlugin/CodeActionMenuPlugin'
import { ImagePlugin } from './images/ImagePlugin'
import { ImageClipboardPlugin } from './clipboard/ImageClipboardPlugin'
import type { EditorMode } from './mode'

export type { EditorMode } from './mode'

function EditorRefPlugin({
  editorRef,
}: {
  editorRef:
    RefCallback<LexicalEditor> | RefObject<LexicalEditor | null | undefined>
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (typeof editorRef === 'function') {
      editorRef(editor)
      return () => {
        editorRef(null)
      }
    } else {
      editorRef.current = editor
      return () => {
        editorRef.current = null
      }
    }
  }, [editor, editorRef])
  return null
}

function EditorModePlugin({ mode }: { mode: EditorMode }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.setEditable(mode === 'edit')
  }, [editor, mode])
  return null
}

export function Nova({
  collaboration,
  cursorsContainerRef,
  editorRef,
  documentId,
  ready = true,
  mode = 'edit',
  pageSetupOpen = false,
  onPageSetupOpenChange = () => {},
}: {
  editorRef?:
    RefCallback<LexicalEditor> | RefObject<LexicalEditor | null | undefined>
  cursorsContainerRef?: RefObject<HTMLDivElement | null>
  collaboration?: React.ReactNode
  documentId?: string
  ready?: boolean
  mode?: EditorMode
  pageSetupOpen?: boolean
  onPageSetupOpenChange?: (open: boolean) => void
}) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null)
  const isEditable = mode === 'edit'
  useEffect(() => {
    return () => {
      if (editorRef && typeof editorRef === 'object') {
        editorRef.current = null
      }
    }
  }, [editorRef])

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
        {cursorsContainerRef && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            ref={cursorsContainerRef}
          />
        )}
        {collaboration}
        <PageSetupPlugin
          open={isEditable && pageSetupOpen}
          onOpenChange={onPageSetupOpenChange}
        />
        {documentId && (
          <DocumentThemePlugin documentId={documentId} ready={ready} />
        )}

        {isEditable && <SlashMenuPlugin />}
        {isEditable && <LinkPlugin />}
        {isEditable && anchorElement && (
          <DragPlugin anchorElement={anchorElement} />
        )}
        {anchorElement && (
          <CodeActionMenuPlugin anchorElement={anchorElement} />
        )}
        {isEditable && <FloatingTextFormatToolbarPlugin />}
      </div>
    </LexicalExtensionComposer>
  )
}
