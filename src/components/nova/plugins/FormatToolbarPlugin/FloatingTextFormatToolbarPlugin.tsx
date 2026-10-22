import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isCodeNode } from '@lexical/code'
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDOMRangeRect, getSelectedNode } from '../../utils'
import { FloatingTextFormatToolbar } from './FloatingTextFormatToolbar'
import type { FormatState, PositionRect } from './types'

const INITIAL_FORMAT_STATE: FormatState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isCode: false,
  isSubscript: false,
  isSuperscript: false,
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
        document.activeElement?.closest('[role="menu"], [role="menubar"]')
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

      const rootRect = rootElement.getBoundingClientRect()
      if (
        domRangeRect.bottom < rootRect.top ||
        domRangeRect.top > rootRect.bottom ||
        domRangeRect.right < rootRect.left ||
        domRangeRect.left > rootRect.right
      ) {
        setIsOpen(false)
        return
      }

      setFormatState({
        isBold: selection.hasFormat('bold'),
        isItalic: selection.hasFormat('italic'),
        isUnderline: selection.hasFormat('underline'),
        isStrikethrough: selection.hasFormat('strikethrough'),
        isCode: selection.hasFormat('code'),
        isSubscript: selection.hasFormat('subscript'),
        isSuperscript: selection.hasFormat('superscript'),
      })

      setRangeRect({
        top: domRangeRect.top,
        left: domRangeRect.left,
        width: domRangeRect.width,
        height: domRangeRect.height,
      })
      setIsOpen(true)
    })
  }, [editor])

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }
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
        updatePopup()
      }
    }

    const handleDragStart = () => {
      isDraggingRef.current = true
      setIsOpen(false)
    }

    const handleDragEnd = () => {
      isDraggingRef.current = false
      updatePopup()
    }

    const unregister = mergeRegister(
      registerEventListener(document, 'selectionchange', updatePopup),
      registerEventListener(document, 'focusin', updatePopup),
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
        updatePopup()
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
          $onUpdate(updatePopup)
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
      }
    }
  }, [editor, updatePopup, scheduleUpdate])

  return (
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
  )
}
