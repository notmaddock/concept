import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { $getNodeByKey } from 'lexical'
import type { NodeKey } from 'lexical'
import { XIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { OutlineLinks } from './OutlineLinks'
import { contentsEmpty, contentsTitle } from './outline'
import { useOutline } from './use-outline'
import { updateDocumentEdit } from '../document-edit'

export function TableOfContentsBlock({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext()
  const editable = useLexicalEditable()
  const [selected] = useLexicalNodeSelection(nodeKey)
  const outline = useOutline(editor)

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
        'group/contents relative my-4 rounded-lg border px-4 py-3 text-sm',
        selected && 'outline-2 outline-primary',
      )}
    >
      <div className="mb-2 pe-7 font-semibold">{contentsTitle}</div>
      {editable && (
        <Button
          aria-label="Remove table of contents"
          className="absolute end-2 top-2 opacity-0 group-hover/contents:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 print:hidden"
          variant="ghost"
          size="icon-xs"
          onClick={remove}
        >
          <XIcon />
        </Button>
      )}
      {outline.length ? (
        <OutlineLinks editor={editor} items={outline} />
      ) : (
        <p className="text-muted-foreground">{contentsEmpty}</p>
      )}
    </nav>
  )
}
