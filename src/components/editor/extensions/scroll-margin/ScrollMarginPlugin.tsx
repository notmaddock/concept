import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  mergeRegister,
} from 'lexical'
import type { LexicalEditor } from 'lexical'

export interface ScrollMarginPluginProps {
  /**
   * Minimum distance in pixels to maintain between the caret and the bottom edge
   * of the scroll container. Keeps active text comfortably above scroll fades.
   * @default 140
   */
  bottomMargin?: number
  /**
   * Minimum distance in pixels to maintain between the caret and the top edge
   * of the scroll container.
   * @default 24
   */
  topMargin?: number
}

function getCaretRect(rootElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!anchorNode || !focusNode) return null

  // Ensure selection endpoints are inside rootElement
  if (!rootElement.contains(anchorNode) || !rootElement.contains(focusNode)) {
    return null
  }

  let range = selection.getRangeAt(0)

  // If selection is not collapsed, get the rect of the active focus end (the moving caret)
  if (!selection.isCollapsed) {
    try {
      range = document.createRange()
      range.setStart(focusNode, selection.focusOffset)
      range.setEnd(focusNode, selection.focusOffset)
    } catch {
      range = selection.getRangeAt(0)
    }
  }

  let rect = range.getBoundingClientRect()

  // Handle collapsed range with 0 height (e.g. empty line with <br>)
  if (rect.height === 0 || rect.bottom === 0) {
    const clientRects = range.getClientRects()
    if (clientRects.length > 0 && clientRects[0].height > 0) {
      rect = clientRects[0]
    } else {
      const element =
        focusNode instanceof Element ? focusNode : focusNode.parentElement
      if (element && rootElement.contains(element)) {
        rect = element.getBoundingClientRect()
      }
    }
  }

  if (rect.height === 0 && rect.bottom === 0) return null
  return rect
}

function scrollSelectionIntoView(
  editor: LexicalEditor,
  bottomMargin: number,
  topMargin: number,
) {
  const rootElement = editor.getRootElement()
  if (!rootElement || !editor.isEditable()) return

  const caretRect = getCaretRect(rootElement)
  if (!caretRect) return

  const rootRect = rootElement.getBoundingClientRect()
  if (rootRect.height <= 0) return

  // Guard against scroll oscillation if container height is small
  const maxMargin = rootRect.height / 2
  const effectiveBottom = Math.min(bottomMargin, maxMargin)
  const effectiveTop = Math.min(topMargin, maxMargin)

  const targetBottom = rootRect.bottom - effectiveBottom
  const targetTop = rootRect.top + effectiveTop

  if (caretRect.bottom > targetBottom) {
    const diff = caretRect.bottom - targetBottom
    rootElement.scrollTop += diff
  } else if (caretRect.top < targetTop && rootElement.scrollTop > 0) {
    const diff = targetTop - caretRect.top
    rootElement.scrollTop = Math.max(0, rootElement.scrollTop - diff)
  }
}

export function ScrollMarginPlugin({
  bottomMargin = 140,
  topMargin = 24,
}: ScrollMarginPluginProps) {
  const [editor] = useLexicalComposerContext()
  const isPointerDownRef = useRef(false)

  // Don't interfere during pointer drag selection
  useEffect(() => {
    const handlePointerDown = () => {
      isPointerDownRef.current = true
    }

    const handlePointerUp = () => {
      if (!isPointerDownRef.current) return
      isPointerDownRef.current = false
      scrollSelectionIntoView(editor, bottomMargin, topMargin)
    }

    window.addEventListener('pointerup', handlePointerUp)

    // Reliably attach to root element when mounted or changed
    const unregisterRoot = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        prevRootElement?.removeEventListener('pointerdown', handlePointerDown)
        rootElement?.addEventListener('pointerdown', handlePointerDown)
      },
    )

    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
      unregisterRoot()
      editor
        .getRootElement()
        ?.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editor, bottomMargin, topMargin])

  // Scroll into view on text mutations and keyboard selection changes
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isPointerDownRef.current) return
        editorState.read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          scrollSelectionIntoView(editor, bottomMargin, topMargin)
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          if (isPointerDownRef.current) return false
          scrollSelectionIntoView(editor, bottomMargin, topMargin)
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, bottomMargin, topMargin])

  return null
}
