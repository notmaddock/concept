import { Loader } from '@cloudflare/kumo'
import { AutoFocusExtension, defineExtension } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { RichTextExtension } from '@lexical/rich-text'
import { ClientOnly } from '@tanstack/react-router'
import { ListExtension } from '@lexical/list'
import type { InitialEditorConfig } from 'lexical'

export function Editor() {
  return (
    <ClientOnly fallback={<EditorSSRFallback />}>
      <CSREditor />
    </ClientOnly>
  )
}

const theme: InitialEditorConfig['theme'] = {}

const editorExtension = defineExtension({
  name: '[root]',
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    ListExtension,
    AutoFocusExtension,
  ],
  theme,
})

function CSREditor() {
  return (
    <LexicalExtensionComposer
      extension={editorExtension}
      contentEditable={null}
    >
      <div className="relative h-full">
        <div className="relative m-1 h-full">
          <ContentEditable
            className="overflow-y-auto scroll-fade-y px-14 py-5 outline-none h-full"
            aria-placeholder="Type '/' for commands..."
            placeholder={
              <div className="pointer-events-none absolute top-[22px] left-14 text-[0.95rem] text-zinc-400 select-none">
                Type &apos;/&apos; for commands&hellip;
              </div>
            }
          />
        </div>
      </div>
    </LexicalExtensionComposer>
  )
}

function EditorSSRFallback() {
  return (
    <main className="size-full flex justify-center items-center">
      <div className="flex items-center gap-4">
        <Loader className="text-primary" />
        <span>Loading Concept Editor...</span>
      </div>
    </main>
  )
}
