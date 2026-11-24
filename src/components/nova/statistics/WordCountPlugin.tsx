import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isTableSelection } from '@lexical/table'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { XIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '#/components/ui/button'
import { countDocumentText } from '#/lib/documents/text-statistics'
import { TOGGLE_WORD_COUNT_COMMAND } from './commands'

function $readStatistics() {
  const selection = $getSelection()
  const selectedText =
    $isTableSelection(selection) ||
    ($isRangeSelection(selection) && !selection.isCollapsed())
      ? selection.getTextContent()
      : ''
  return {
    document: countDocumentText($getRoot().getTextContent()),
    selection: selectedText ? countDocumentText(selectedText) : null,
  }
}

function WordCount({ close }: { close: () => void }) {
  const [editor] = useLexicalComposerContext()
  const title = useId()
  const [statistics, setStatistics] = useState(() =>
    editor.getEditorState().read($readStatistics),
  )

  useEffect(() => {
    const refresh = (state = editor.getEditorState()) =>
      setStatistics(state.read($readStatistics))
    refresh()
    return editor.registerUpdateListener(({ editorState, prevEditorState }) => {
      if (editorState !== prevEditorState) refresh(editorState)
    })
  }, [editor])

  const counts = statistics.selection ?? statistics.document
  const rows = [
    ['Words', counts.words],
    ['Characters', counts.characters],
    ['Characters excluding spaces', counts.charactersWithoutSpaces],
  ] as const

  return createPortal(
    <section
      role="dialog"
      aria-labelledby={title}
      className="fixed bottom-4 right-4 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg print:hidden"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        close()
        editor.focus()
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={title} className="font-semibold">
          Word count
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close word count"
          onClick={() => {
            close()
            editor.focus()
          }}
        >
          <XIcon />
        </Button>
      </div>
      <p className="mb-2 text-sm text-muted-foreground">
        {statistics.selection ? 'Selection' : 'Entire document'}
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, count]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="text-right tabular-nums">
              {count.toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
    </section>,
    document.body,
  )
}

export function WordCountPlugin() {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)

  useEffect(
    () =>
      editor.registerCommand(
        TOGGLE_WORD_COUNT_COMMAND,
        () => {
          setOpen((current) => !current)
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )

  return open ? <WordCount close={() => setOpen(false)} /> : null
}
