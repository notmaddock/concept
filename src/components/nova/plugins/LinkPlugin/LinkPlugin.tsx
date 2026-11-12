import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  $toggleLink,
} from '@lexical/link'
import type { LinkNode } from '@lexical/link'
import { $findMatchingParent } from '@lexical/utils'
import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
  mergeRegister,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import type { BaseSelection, RangeSelection } from 'lexical'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getSelectedNode } from '../../utils'
import { linkAttributes, normalizeLinkUrl } from '#/lib/documents/link-policy'
import { OPEN_LINK_DIALOG_COMMAND } from './commands'
import type { LinkDialogValue } from './LinkDialog'
import type { FloatingLinkRect } from './FloatingLinkEditor'

const LinkDialog = lazy(() =>
  import('./LinkDialog').then((module) => ({ default: module.LinkDialog })),
)
const FloatingLinkEditor = lazy(() =>
  import('./FloatingLinkEditor').then((module) => ({
    default: module.FloatingLinkEditor,
  })),
)

function $findLinkNode(selection: BaseSelection | null) {
  if (!$isRangeSelection(selection)) return null
  const node = getSelectedNode(selection)
  if ($isLinkNode(node)) return node
  const parent = $findMatchingParent(node, $isLinkNode)
  return $isLinkNode(parent) ? parent : null
}

function $removeLink(link: LinkNode) {
  if ($isAutoLinkNode(link)) {
    link.setIsUnlinked(true)
    return
  }
  for (const child of link.getChildren()) link.insertBefore(child)
  link.remove()
}

function $setLinkText(link: LinkNode, text: string) {
  const content = text.trim() || link.getURL()
  if (content === link.getTextContent()) return
  const first = link.getFirstChild()
  if (link.getChildrenSize() === 1 && $isTextNode(first))
    first.setTextContent(content)
  else link.clear().append($createTextNode(content))
}

type FloatingState = {
  key: string
  url: string
  text: string
  rect: FloatingLinkRect
}

export function LinkPlugin() {
  const [editor] = useLexicalComposerContext()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogValue, setDialogValue] = useState<LinkDialogValue>({
    url: '',
    text: '',
    hasLink: false,
  })
  const [floating, setFloating] = useState<FloatingState | null>(null)
  const savedSelection = useRef<RangeSelection | null>(null)
  const dialogOpenRef = useRef(false)
  const floatingRef = useRef<FloatingState | null>(null)

  useEffect(() => {
    dialogOpenRef.current = dialogOpen
  }, [dialogOpen])

  useEffect(() => {
    floatingRef.current = floating
  }, [floating])

  const openDialog = useCallback(() => {
    editor.update(() => {
      let selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }
      if (!$isRangeSelection(selection)) return
      savedSelection.current = selection.clone()
      const link = $findLinkNode(selection)
      setDialogValue({
        url: link?.getURL() ?? '',
        text: link?.getTextContent() ?? selection.getTextContent(),
        hasLink: Boolean(link),
      })
      setDialogOpen(true)
    })
  }, [editor])

  const submitDialog = useCallback(
    (value: { url: string; text: string; remove: boolean }) => {
      const normalized = value.remove ? null : normalizeLinkUrl(value.url)
      if (!value.remove && !normalized) {
        toast.error('Enter a valid http, https, mailto, or tel link.')
        return false
      }
      editor.update(() => {
        if (savedSelection.current)
          $setSelection(savedSelection.current.clone())
        let selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          const root = $getRoot()
          root.selectEnd()
          selection = $getSelection()
        }
        if (!$isRangeSelection(selection)) return
        if (normalized === null) {
          const link = $findLinkNode(selection)
          if (link) $removeLink(link)
          return
        }
        const attributes = linkAttributes(normalized)
        const link = $findLinkNode(selection)
        if (link && $isAutoLinkNode(link)) {
          const replacement = $createLinkNode(normalized, attributes).append(
            $createTextNode(value.text.trim() || normalized),
          )
          $setSelection(null)
          link.replace(replacement)
          replacement.selectEnd()
          return
        }
        if (link) {
          link.setURL(normalized)
          link.setTarget(attributes.target ?? null)
          link.setRel(attributes.rel ?? null)
          $setLinkText(link, value.text)
          return
        }
        if (!selection.isCollapsed()) {
          $toggleLink({ url: normalized, ...attributes })
          const created = $findLinkNode($getSelection())
          if (created) $setLinkText(created, value.text)
          return
        }
        const node = $createLinkNode(normalized, attributes).append(
          $createTextNode(value.text.trim() || normalized),
        )
        selection.insertNodes([node])
        node.selectEnd()
      })
      editor.focus()
      return true
    },
    [editor],
  )

  const updateFloating = useCallback(() => {
    if (dialogOpenRef.current) return
    if (document.activeElement?.closest('[data-link-editor]')) return
    if (!editor.isEditable()) {
      setFloating(null)
      return
    }
    const selection = $getSelection()
    const link = $findLinkNode(selection)
    if (!link) {
      setFloating(null)
      return
    }
    const element = editor.getElementByKey(link.getKey())
    if (!element) {
      setFloating(null)
      return
    }
    const rect = element.getBoundingClientRect()
    setFloating({
      key: link.getKey(),
      url: link.getURL(),
      text: link.getTextContent(),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    })
  }, [editor])

  const submitFloating = useCallback(
    (value: { url: string; text: string }) => {
      const normalized = normalizeLinkUrl(value.url)
      if (!normalized) {
        toast.error('Enter a valid http, https, mailto, or tel link.')
        return false
      }
      const key = floating?.key
      if (!key) return false
      editor.update(() => {
        const node = $getNodeByKey(key)
        if (!$isLinkNode(node)) return
        const attributes = linkAttributes(normalized)
        if ($isAutoLinkNode(node)) {
          const replacement = $createLinkNode(normalized, attributes).append(
            $createTextNode(value.text.trim() || normalized),
          )
          $setSelection(null)
          node.replace(replacement)
          replacement.selectEnd()
          return
        }
        node.setURL(normalized)
        node.setTarget(attributes.target ?? null)
        node.setRel(attributes.rel ?? null)
        $setLinkText(node, value.text)
      })
      return true
    },
    [editor, floating],
  )

  const removeFloating = useCallback(() => {
    const key = floating?.key
    if (!key) return
    editor.update(() => {
      const node = $getNodeByKey(key)
      if (!$isLinkNode(node)) return
      $removeLink(node)
    })
    setFloating(null)
  }, [editor, floating])

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_LINK_DIALOG_COMMAND,
        () => {
          openDialog()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'k'
          ) {
            event.preventDefault()
            openDialog()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (!floatingRef.current) return false
          setFloating(null)
          return true
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateFloating()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(updateFloating)
      }),
      editor.registerEditableListener((editable) => {
        if (!editable) setFloating(null)
      }),
      editor.registerRootListener((root) => {
        if (!root) setFloating(null)
      }),
    )
  }, [editor, openDialog, updateFloating])

  useEffect(() => {
    if (!floating) return
    const update = () => editor.getEditorState().read(updateFloating)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [editor, floating, updateFloating])

  return (
    <>
      {dialogOpen && (
        <Suspense fallback={null}>
          <LinkDialog
            open
            value={dialogValue}
            onOpenChange={(open) => {
              setDialogOpen(open)
              if (open) setFloating(null)
              else editor.focus()
            }}
            onSubmit={submitDialog}
          />
        </Suspense>
      )}
      {floating && (
        <Suspense fallback={null}>
          <FloatingLinkEditor
            rect={floating.rect}
            url={floating.url}
            text={floating.text}
            onSubmit={submitFloating}
            onRemove={removeFloating}
            onClose={() => setFloating(null)}
          />
        </Suspense>
      )}
    </>
  )
}
