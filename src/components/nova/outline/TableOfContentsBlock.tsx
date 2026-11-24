import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { $getNodeByKey, $setState } from 'lexical'
import type { NodeKey } from 'lexical'
import { CheckIcon, Settings2Icon, XIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import { $getPageSetup } from '#/lib/documents/page-setup'
import { OutlineLinks } from './OutlineLinks'
import { contentsEmpty, contentsTitle } from './outline'
import { useOutline } from './use-outline'
import { updateDocumentEdit } from '../document-edit'
import { contentsStyles, contentsStyleState } from './contents-style'
import type { ContentsStyle } from './contents-style'

export function TableOfContentsBlock({
  nodeKey,
  style,
}: {
  nodeKey: NodeKey
  style: ContentsStyle
}) {
  const [editor] = useLexicalComposerContext()
  const editable = useLexicalEditable()
  const [selected] = useLexicalNodeSelection(nodeKey)
  const outline = useOutline(editor)
  const paged = useSyncExternalStore(
    (listener) => editor.registerUpdateListener(listener),
    () => editor.getEditorState().read(() => $getPageSetup().mode === 'paper'),
    () => false,
  )
  const activeStyle = paged ? style : 'links'

  function setStyle(next: ContentsStyle) {
    if (!editor.isEditable() || (!paged && next !== 'links')) return
    updateDocumentEdit(editor, () => {
      const node = $getNodeByKey(nodeKey)
      if (node) $setState(node, contentsStyleState, next)
    })
  }

  function remove() {
    if (!editor.isEditable()) return
    updateDocumentEdit(editor, () => {
      const node = $getNodeByKey(nodeKey)
      if (!node) return
      node.selectNext(0, 0)
      node.remove()
    })
    editor.focus()
  }

  return (
    <nav
      aria-label={contentsTitle}
      contentEditable={false}
      className={cn(
        'group/contents relative my-4 text-sm',
        selected && 'outline-2 outline-offset-4 outline-ring',
      )}
    >
      {editable && (
        <div className="absolute -top-6 end-0 z-1 flex rounded-md bg-popover opacity-0 group-hover/contents:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 print:hidden">
          <Button
            aria-label="Remove table of contents"
            title="Remove table of contents"
            variant="ghost"
            size="icon-xs"
            onClick={remove}
          >
            <XIcon />
          </Button>
          <Popover>
            <PopoverTrigger
              aria-label="Table of contents style"
              title="Table of contents style"
              render={<Button variant="ghost" size="icon-xs" />}
            >
              <Settings2Icon />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-44 gap-1 rounded-xl p-2"
              aria-label="Table of contents style"
            >
              <PopoverTitle className="px-2 text-sm">
                Contents style
              </PopoverTitle>
              {contentsStyles.map(({ id, label }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  aria-pressed={activeStyle === id}
                  disabled={!paged && id !== 'links'}
                  className="justify-between"
                  onClick={() => setStyle(id)}
                >
                  {label}
                  {activeStyle === id && <CheckIcon />}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      )}
      {outline.length ? (
        <OutlineLinks editor={editor} items={outline} style={activeStyle} />
      ) : editable ? (
        <p className="text-muted-foreground print:hidden">{contentsEmpty}</p>
      ) : null}
    </nav>
  )
}
