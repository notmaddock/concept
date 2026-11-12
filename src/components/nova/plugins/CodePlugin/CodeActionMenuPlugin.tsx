import { $isCodeNode, CodeNode } from '@lexical/code'
import {
  getCodeLanguageOptions,
  getLanguageFriendlyName,
  normalizeCodeLanguage,
} from '@lexical/code-prism'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  mergeRegister,
} from 'lexical'
import type { NodeKey } from 'lexical'
import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

const NO_LANGUAGE = '__none__'

const languageOptions = [
  { value: NO_LANGUAGE, label: 'Plain text' },
  ...getCodeLanguageOptions()
    .filter(([value]) => value !== 'plain')
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

function isMenuTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[data-code-action-menu], [data-slot="select-trigger"], [data-slot="select-content"]',
      ),
    )
  )
}

function positionFor(element: HTMLElement, anchorElement: HTMLElement) {
  const anchorRect = anchorElement.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return {
    top: Math.max(4, rect.top - anchorRect.top + 4),
    right: Math.max(4, anchorRect.right - rect.right + 4),
  }
}

interface ActiveCode {
  key: NodeKey
  language: string
  top: number
  right: number
}

export function CodeActionMenuPlugin({
  anchorElement,
}: {
  anchorElement: HTMLElement
}) {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState<ActiveCode | null>(null)
  const [copied, setCopied] = useState(false)
  const editable = useSyncExternalStore(
    (listener) => editor.registerEditableListener(listener),
    () => editor.isEditable(),
    () => true,
  )
  const menuRef = useRef<HTMLDivElement>(null)
  const activeElementRef = useRef<HTMLElement | null>(null)
  const activeKeyRef = useRef<NodeKey | null>(null)
  const frameRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  const hide = useCallback(() => {
    activeElementRef.current = null
    activeKeyRef.current = null
    setActive(null)
  }, [])

  const schedulePosition = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const element = activeElementRef.current
      if (!element?.isConnected) return
      const { top, right } = positionFor(element, anchorElement)
      setActive((current) =>
        current && (current.top !== top || current.right !== right)
          ? { ...current, top, right }
          : current,
      )
    })
  }, [anchorElement])

  const showForCodeElement = useCallback(
    (element: HTMLElement) => {
      if (element === activeElementRef.current) return
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(element)
        if (!$isCodeNode(node)) return
        activeElementRef.current = element
        activeKeyRef.current = node.getKey()
        const { top, right } = positionFor(element, anchorElement)
        setActive({
          key: node.getKey(),
          language: node.getLanguage() ?? NO_LANGUAGE,
          top,
          right,
        })
      })
    },
    [editor, anchorElement],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (isMenuTarget(target)) return
      const codeElement =
        target instanceof Element
          ? target.closest<HTMLElement>('code.code-block')
          : null
      if (codeElement && anchorElement.contains(codeElement)) {
        showForCodeElement(codeElement)
        return
      }
      hide()
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (isMenuTarget(target)) return
      const codeElement =
        target instanceof Element
          ? target.closest<HTMLElement>('code.code-block')
          : null
      if (codeElement) showForCodeElement(codeElement)
      else if (activeKeyRef.current) hide()
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      const anchorNode = selection?.anchorNode
      if (!anchorNode || !anchorElement.contains(anchorNode)) return
      const element =
        anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
      const codeElement = element?.closest<HTMLElement>('code.code-block')
      if (codeElement) {
        showForCodeElement(codeElement)
        return
      }
      if (activeKeyRef.current && !isMenuTarget(document.activeElement)) hide()
    }

    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        const key = activeKeyRef.current
        if (!key) return
        editorState.read(() => {
          const node = $getNodeByKey(key)
          if (!$isCodeNode(node)) {
            hide()
            return
          }
          const language = node.getLanguage() ?? NO_LANGUAGE
          setActive((current) =>
            current && current.key === key && current.language !== language
              ? { ...current, language }
              : current,
          )
          schedulePosition()
        })
      }),
      editor.registerMutationListener(
        CodeNode,
        (mutations) => {
          const key = activeKeyRef.current
          if (key && mutations.get(key) === 'destroyed') hide()
        },
        { skipInitialization: true },
      ),
    )

    anchorElement.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('selectionchange', handleSelectionChange)
    window.addEventListener('scroll', schedulePosition, true)
    window.addEventListener('resize', schedulePosition)

    return () => {
      unregister()
      anchorElement.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current)
    }
  }, [anchorElement, editor, hide, schedulePosition, showForCodeElement])

  const handleLanguageChange = useCallback(
    (value: string) => {
      const key = activeKeyRef.current
      if (!key) return
      editor.update(() => {
        const node = $getNodeByKey(key)
        if ($isCodeNode(node))
          node.setLanguage(value === NO_LANGUAGE ? undefined : value)
      })
    },
    [editor],
  )

  const handleCopy = useCallback(async () => {
    const key = activeKeyRef.current
    if (!key) return
    const text = editor.getEditorState().read(() => {
      const node = $getNodeByKey(key)
      return $isCodeNode(node) ? node.getTextContent() : ''
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedTimerRef.current = null
      }, 1200)
    } catch {
      toast.error('Could not copy the code block.')
    }
  }, [editor])

  if (!active) return null

  const normalizedLanguage =
    active.language === NO_LANGUAGE
      ? NO_LANGUAGE
      : normalizeCodeLanguage(active.language)
  const selectedLanguage = languageOptions.some(
    (option) => option.value === normalizedLanguage,
  )
    ? normalizedLanguage
    : NO_LANGUAGE

  return createPortal(
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Code block actions"
      data-code-action-menu
      className="absolute z-20 flex items-center gap-1 rounded-2xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5"
      style={{ top: active.top, right: active.right }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Select
        value={selectedLanguage}
        onValueChange={(value) => {
          if (typeof value === 'string') handleLanguageChange(value)
        }}
        disabled={!editable}
      >
        <SelectTrigger
          size="sm"
          aria-label="Code language"
          className="h-7 w-36 rounded-xl border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted focus-visible:ring-2"
        >
          <SelectValue>
            {(value) => {
              const language = String(value ?? NO_LANGUAGE)
              return language === NO_LANGUAGE
                ? 'Plain text'
                : getLanguageFriendlyName(language)
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="max-h-72">
          {languageOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="rounded-xl"
        aria-label={copied ? 'Code copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleCopy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>,
    anchorElement,
  )
}
