import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { isMac } from '#/components/documents/navigation-menus/ActionShortcut'
import { updateDocumentEdit } from '../document-edit'
import { matchEditorShortcut } from '../editor-shortcuts'
import { OPEN_FIND_COMMAND } from './commands'
import { $findDocumentMatches, $replaceDocumentMatch } from './document-matches'
import type { DocumentMatch, MatchPoint } from './document-matches'
import './find.css'

function getDOMPoint(editor: LexicalEditor, point: MatchPoint) {
  const element = editor.getElementByKey(point.key)
  if (!element) return
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  )
  let offset = point.offset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (offset <= length) return { node, offset }
    offset -= length
  }
}

function createDOMRange(editor: LexicalEditor, match: DocumentMatch) {
  const start = getDOMPoint(editor, match.start)
  const end = getDOMPoint(editor, match.end)
  if (!start || !end) return
  const range = start.node.ownerDocument?.createRange()
  range?.setStart(start.node, start.offset)
  range?.setEnd(end.node, end.offset)
  return range
}

type FindRequest = { selectedText: string }

function FindPanel({
  request,
  close,
}: {
  request: FindRequest
  close: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const title = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(request.selectedText)
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [index, setIndex] = useState(0)
  const [matches, setMatches] = useState<DocumentMatch[]>([])
  const editable = useSyncExternalStore(
    (listener) => editor.registerEditableListener(listener),
    () => editor.isEditable(),
    () => false,
  )
  const current = Math.min(index, Math.max(0, matches.length - 1))
  const activeMatch = matches.at(current)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [request])

  useEffect(() => {
    const update = (state = editor.getEditorState()) => {
      setMatches(state.read(() => $findDocumentMatches(query, matchCase)))
    }
    update()
    return editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size || dirtyLeaves.size) update(editorState)
      },
    )
  }, [editor, query, matchCase])

  useEffect(() => {
    if (!('Highlight' in window) || !('highlights' in CSS)) return
    const ranges = new Highlight()
    const active = new Highlight()
    active.priority = 1
    matches.forEach((match) => {
      const range = createDOMRange(editor, match)
      if (range) (match === activeMatch ? active : ranges).add(range)
    })
    CSS.highlights.set('concept-find', ranges)
    CSS.highlights.set('concept-find-active', active)
    return () => {
      CSS.highlights.delete('concept-find')
      CSS.highlights.delete('concept-find-active')
    }
  }, [editor, matches, activeMatch])

  useEffect(() => {
    if (!activeMatch) return
    const element = editor.getElementByKey(activeMatch.start.key)
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const viewport = element?.closest('main')
    const rect = createDOMRange(editor, activeMatch)?.getBoundingClientRect()
    if (!viewport || !rect) return
    const bounds = viewport.getBoundingClientRect()
    if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
      viewport.scrollBy({
        top: rect.top - bounds.top - viewport.clientHeight / 2,
      })
    }
  }, [editor, activeMatch])

  function move(delta: number) {
    if (matches.length)
      setIndex((current + delta + matches.length) % matches.length)
  }

  function replace(all: boolean) {
    if (!editor.isEditable()) return
    updateDocumentEdit(
      editor,
      () => {
        const fresh = $findDocumentMatches(query, matchCase)
        const targets = all
          ? fresh.reverse()
          : fresh.slice(current, current + 1)
        if (!targets.length) return
        for (const match of targets) $replaceDocumentMatch(match, replacement)
        $setSelection(null)
        const remaining = all
          ? 0
          : $findDocumentMatches(query, matchCase).length
        const added = Math.max(0, remaining - fresh.length + 1)
        setIndex(remaining ? (current + added) % remaining : 0)
        if (!remaining) input.current?.focus({ preventScroll: true })
      },
      { tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] },
    )
  }

  function dismiss() {
    close()
    if (editor.isEditable()) editor.focus()
  }

  return createPortal(
    <section
      role="dialog"
      aria-labelledby={title}
      className="fixed right-4 top-24 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg print:hidden"
      onKeyDown={(event) => {
        if (matchEditorShortcut(event.nativeEvent, isMac())?.id === 'find') {
          event.preventDefault()
          input.current?.focus()
          input.current?.select()
          return
        }
        if (event.key === 'Escape') {
          event.stopPropagation()
          dismiss()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={title} className="font-semibold">
          {editable ? 'Find and replace' : 'Find in document'}
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close find"
          onClick={dismiss}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Input
          ref={input}
          aria-label="Find text"
          placeholder="Find text"
          value={query}
          className="min-w-0 flex-1"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            move(event.shiftKey ? -1 : 1)
          }}
        />
        <p
          role="status"
          className="px-1 text-sm whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {query &&
            (matches.length
              ? `${current + 1} of ${matches.length}`
              : 'No matches')}
        </p>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Previous match"
          disabled={!matches.length}
          onClick={() => move(-1)}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Next match"
          disabled={!matches.length}
          onClick={() => move(1)}
        >
          <ChevronDownIcon />
        </Button>
      </div>
      {editable && (
        <div className="mt-2 flex items-center gap-1">
          <Input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            className="min-w-0 flex-1"
            onChange={(event) => setReplacement(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!matches.length}
            onClick={() => replace(false)}
          >
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!matches.length}
            onClick={() => replace(true)}
          >
            Replace all
          </Button>
        </div>
      )}
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={matchCase}
          onChange={(event) => {
            setMatchCase(event.target.checked)
            setIndex(0)
          }}
        />
        Match case
      </label>
    </section>,
    document.body,
  )
}

export function FindPlugin() {
  const [editor] = useLexicalComposerContext()
  const [request, setRequest] = useState<FindRequest | null>(null)

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_FIND_COMMAND,
        () => {
          const selection = $getSelection()
          const selectedText = $isRangeSelection(selection)
            ? selection.getTextContent()
            : ''
          setRequest({
            selectedText:
              selectedText.length <= 256 && !selectedText.includes('\n')
                ? selectedText
                : '',
          })
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )

  return request ? (
    <FindPanel request={request} close={() => setRequest(null)} />
  ) : null
}
