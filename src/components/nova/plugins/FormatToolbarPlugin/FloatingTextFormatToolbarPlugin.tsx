import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isCodeNode } from '@lexical/code'
import { $isLinkNode } from '@lexical/link'
import { $findMatchingParent } from '@lexical/utils'
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $onUpdate,
  COMMAND_PRIORITY_LOW,
  getDOMSelection,
  getDOMSelectionPoints,
  KEY_ESCAPE_COMMAND,
  mergeRegister,
  registerEventListener,
  registerEventListeners,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { getDOMRangeRect, getSelectedNode } from '../../utils'
import type { FormatState, PositionRect } from './types'

const FloatingTextFormatToolbar = lazy(() =>
  import('./FloatingTextFormatToolbar').then((module) => ({
    default: module.FloatingTextFormatToolbar,
  })),
)
const INITIAL_FORMAT_STATE: FormatState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isCode: false,
  isSubscript: false,
  isSuperscript: false,
  isLink: false,
}

function getNearestScrollContainer(node: Node | null): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  const win = current?.ownerDocument.defaultView ?? window

  while (
    current &&
    current !== current.ownerDocument.body &&
    current !== current.ownerDocument.documentElement
  ) {
    if (typeof win.getComputedStyle === 'function') {
      const style = win.getComputedStyle(current)
      if (
        /(auto|scroll|overlay)/.test(
          `${style.overflow}${style.overflowY}${style.overflowX}`,
        )
      ) {
        return current
      }
    }
    current = current.parentElement
  }

  return null
}

export function FloatingTextFormatToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [rangeRect, setRangeRect] = useState<PositionRect | null>(null)
  const [formatState, setFormatState] =
    useState<FormatState>(INITIAL_FORMAT_STATE)

  const isPointerDownRef = useRef(false)
  const isDraggingRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)

  const updatePopup = useCallback(() => {
    if (isPointerDownRef.current || isDraggingRef.current) {
      return
    }

    if (document.activeElement?.closest('[data-format-toolbar]')) return

    editor.read('latest', () => {
      if (
        editor.isComposing() ||
        !editor.isEditable() ||
        document.activeElement?.closest(
          '[role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"]',
        )
      ) {
        setIsOpen(false)
        return
      }

      const selection = $getSelection()
      const nativeSelection = getDOMSelection(editor._window)
      const rootElement = editor.getRootElement()

      if (
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        nativeSelection === null ||
        rootElement === null
      ) {
        setIsOpen(false)
        return
      }

      const points = getDOMSelectionPoints(nativeSelection, rootElement)
      if (
        !rootElement.contains(points.anchorNode) ||
        !rootElement.contains(points.focusNode) ||
        (points.anchorNode === points.focusNode &&
          points.anchorOffset === points.focusOffset)
      ) {
        setIsOpen(false)
        return
      }

      const node = getSelectedNode(selection)
      const parent = node.getParent()
      const anchorNode = selection.anchor.getNode()
      const focusNode = selection.focus.getNode()

      if (
        $isCodeNode(node) ||
        $isCodeNode(parent) ||
        $isCodeNode(anchorNode) ||
        $isCodeNode(anchorNode.getParent()) ||
        $isCodeNode(focusNode) ||
        $isCodeNode(focusNode.getParent())
      ) {
        setIsOpen(false)
        return
      }

      const rawTextContent = selection.getTextContent().replace(/\n/g, '')
      if (rawTextContent === '') {
        setIsOpen(false)
        return
      }

      if (!$isTextNode(node) && !$isElementNode(node)) {
        setIsOpen(false)
        return
      }

      const domRangeRect = getDOMRangeRect(nativeSelection, rootElement)
      if (domRangeRect.width === 0 && domRangeRect.height === 0) {
        setIsOpen(false)
        return
      }

      const win = editor._window ?? window
      let clipTop = 0
      let clipLeft = 0
      let clipBottom = win.innerHeight
      let clipRight = win.innerWidth

      const scrollContainer = getNearestScrollContainer(
        points.anchorNode ?? rootElement,
      )
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect()
        clipTop = Math.max(clipTop, containerRect.top)
        clipBottom = Math.min(clipBottom, containerRect.bottom)
        clipLeft = Math.max(clipLeft, containerRect.left)
        clipRight = Math.min(clipRight, containerRect.right)
      }

      const rootRect = rootElement.getBoundingClientRect()
      clipTop = Math.max(clipTop, rootRect.top)
      clipBottom = Math.min(clipBottom, rootRect.bottom)
      clipLeft = Math.max(clipLeft, rootRect.left)
      clipRight = Math.min(clipRight, rootRect.right)

      const clippedTop = Math.max(domRangeRect.top, clipTop)
      const clippedBottom = Math.min(domRangeRect.bottom, clipBottom)
      const clippedLeft = Math.max(domRangeRect.left, clipLeft)
      const clippedRight = Math.min(domRangeRect.right, clipRight)

      if (clippedBottom <= clippedTop || clippedRight <= clippedLeft) {
        setIsOpen(false)
        return
      }

      const nextFormatState: FormatState = {
        isBold: selection.hasFormat('bold'),
        isItalic: selection.hasFormat('italic'),
        isUnderline: selection.hasFormat('underline'),
        isStrikethrough: selection.hasFormat('strikethrough'),
        isCode: selection.hasFormat('code'),
        isSubscript: selection.hasFormat('subscript'),
        isSuperscript: selection.hasFormat('superscript'),
        isLink:
          $isLinkNode(node) ||
          $isLinkNode($findMatchingParent(node, $isLinkNode)),
      }
      setFormatState((current) =>
        (Object.keys(nextFormatState) as (keyof FormatState)[]).every(
          (key) => current[key] === nextFormatState[key],
        )
          ? current
          : nextFormatState,
      )
      const nextRect: PositionRect = {
        top: clippedTop,
        left: clippedLeft,
        width: clippedRight - clippedLeft,
        height: clippedBottom - clippedTop,
      }
      setRangeRect((current) =>
        current &&
        current.top === nextRect.top &&
        current.left === nextRect.left &&
        current.width === nextRect.width &&
        current.height === nextRect.height
          ? current
          : nextRect,
      )
      setIsOpen(true)
    })
  }, [editor])

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      updatePopup()
    })
  }, [updatePopup])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-format-toolbar]')) {
        return
      }
      isPointerDownRef.current = true
    }

    const handlePointerUp = () => {
      if (isPointerDownRef.current) {
        isPointerDownRef.current = false
        scheduleUpdate()
      }
    }

    const handleDragStart = () => {
      isDraggingRef.current = true
      setIsOpen(false)
    }

    const handleDragEnd = () => {
      isDraggingRef.current = false
      scheduleUpdate()
    }

    const unregister = mergeRegister(
      registerEventListener(document, 'selectionchange', scheduleUpdate),
      registerEventListener(document, 'focusin', scheduleUpdate),
      registerEventListener(document, 'pointerdown', handlePointerDown),
      registerEventListener(document, 'pointerup', handlePointerUp),
      registerEventListener(document, 'pointercancel', handlePointerUp),
      registerEventListeners(
        document,
        {
          dragstart: handleDragStart,
          dragend: handleDragEnd,
          drop: handleDragEnd,
        },
        true,
      ),
      registerEventListener(window, 'resize', scheduleUpdate),
      registerEventListener(window, 'scroll', scheduleUpdate, {
        capture: true,
        passive: true,
      }),
      editor.registerUpdateListener(() => {
        scheduleUpdate()
      }),
      editor.registerRootListener((rootElement) => {
        if (rootElement === null) {
          setIsOpen(false)
        }
      }),
      editor.registerEditableListener((editable) => {
        if (!editable) {
          setIsOpen(false)
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $onUpdate(scheduleUpdate)
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          setIsOpen(false)
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )

    return () => {
      unregister()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [editor, updatePopup, scheduleUpdate])

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <FloatingTextFormatToolbar
        editor={editor}
        isOpen={isOpen}
        rangeRect={rangeRect}
        formatState={formatState}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setIsOpen(false)
          }
        }}
      />
    </Suspense>
  )
}
