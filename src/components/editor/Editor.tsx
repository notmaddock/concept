import { Loader } from '@cloudflare/kumo'
import {
  AutoFocusExtension,
  defineExtension,
  TabIndentationExtension,
} from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { RichTextExtension } from '@lexical/rich-text'
import { ClientOnly } from '@tanstack/react-router'
import { CheckListExtension, ListExtension } from '@lexical/list'
import type { InitialEditorConfig } from 'lexical'
import {
  SlashCommandExtension,
  SlashCommandPlugin,
} from './extensions/slash-command'

export function Editor() {
  return (
    <ClientOnly fallback={<EditorSSRFallback />}>
      <CSREditor />
    </ClientOnly>
  )
}

const theme: InitialEditorConfig['theme'] = {
  paragraph: 'mb-2 leading-relaxed',
  heading: {
    h1: 'text-3xl font-bold tracking-tight mb-4 mt-6',
    h2: 'text-2xl font-semibold tracking-tight mb-3 mt-5',
    h3: 'text-xl font-semibold tracking-tight mb-2 mt-4',
  },
  quote: 'border-l-2 border-primary/60 pl-4 italic text-muted-foreground my-3',
  list: {
    ul: 'list-outside ml-6 my-2 space-y-1',
    ulDepth: [
      'list-disc',
      'list-[circle]',
      'list-[square]',
      'list-disc',
      'list-[circle]',
    ],
    ol: 'list-outside ml-6 my-2 space-y-1',
    olDepth: [
      'list-decimal',
      'list-[lower-alpha]',
      'list-[lower-roman]',
      'list-decimal',
      'list-[lower-alpha]',
    ],
    checklist: 'list-none! pl-0! ml-1 my-2 space-y-1.5 [&_ul]:ml-6 [&_ul]:my-1',
    listitem: 'leading-relaxed',
    listitemChecked: 'editor-checklist-item-checked',
    listitemUnchecked: 'editor-checklist-item-unchecked',
    nested: {
      list: 'my-1',
      listitem: 'list-none',
    },
  },
  hr: 'my-4 border-t border-border',
}

const editorExtension = defineExtension({
  name: '[root]',
  dependencies: [
    RichTextExtension,
    HistoryExtension,
    ListExtension,
    CheckListExtension,
    TabIndentationExtension,
    AutoFocusExtension,
    SlashCommandExtension,
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
              <div className="pointer-events-none absolute top-[22px] left-14 text-[0.95rem] text-muted-foreground select-none">
                Type &apos;/&apos; for commands&hellip;
              </div>
            }
          />
          <SlashCommandPlugin />
        </div>
      </div>
    </LexicalExtensionComposer>
  )
}

function EditorSSRFallback() {
  return (
    <main className="size-full flex justify-center items-center">
      <div className="flex items-center gap-4">
        <Loader size="base" />
        <p className="text-muted-foreground font-mono text-xs">
          Loading editor...
        </p>
      </div>
    </main>
  )
}
