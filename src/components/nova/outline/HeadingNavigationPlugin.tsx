import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isHeadingNode } from '@lexical/rich-text'
import {
  $getNodeByKey,
  SKIP_SCROLL_INTO_VIEW_TAG,
  mergeRegister,
} from 'lexical'
import type { LexicalEditor, NodeKey } from 'lexical'
import {
  documentIdFromHash,
  headingFragment,
  headingFromFragment,
} from '#/lib/documents/document-url'
import { $readOutline } from './outline'

const visited = new WeakMap<LexicalEditor, string>()

export function jumpToHeading(editor: LexicalEditor, key: NodeKey) {
  const heading = editor.getElementByKey(key)
  if (!heading) return
  if (editor.isEditable()) {
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.update(
      () => {
        const node = $getNodeByKey(key)
        if ($isHeadingNode(node)) node.selectStart()
      },
      { tag: SKIP_SCROLL_INTO_VIEW_TAG },
    )
  } else {
    heading.focus({ preventScroll: true })
  }
  heading.scrollIntoView({ block: 'start', inline: 'nearest' })
}

export function openHeading(editor: LexicalEditor, key: NodeKey, id: string) {
  const hash = `#${headingFragment(id, window.location)}`
  visited.set(editor, hash)
  if (window.location.hash !== hash) window.location.hash = hash
  jumpToHeading(editor, key)
}

export function HeadingNavigationPlugin({
  ready,
  documentId,
}: {
  ready: boolean
  documentId?: string
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!ready) return
    let anchors = new Set<HTMLElement>()
    const synchronize = (state = editor.getEditorState()) => {
      const { pathname, hash } = window.location
      if (
        pathname === '/' &&
        documentId &&
        documentIdFromHash(hash.slice(1)) !== documentId
      )
        return
      const destination = headingFromFragment(hash)
      const nextAnchors = new Set<HTMLElement>()
      let target: NodeKey | undefined
      for (const { key, id } of state.read($readOutline)) {
        const element = editor.getElementByKey(key)
        if (!element) continue
        const fragment = headingFragment(id, window.location)
        if (element.id !== fragment) element.id = fragment
        if (!anchors.delete(element)) element.tabIndex = -1
        nextAnchors.add(element)
        if (id === destination) target = key
      }
      for (const element of anchors) {
        element.removeAttribute('id')
        element.removeAttribute('tabindex')
      }
      anchors = nextAnchors
      if (!destination) visited.delete(editor)
      if (target && visited.get(editor) !== hash) {
        visited.set(editor, hash)
        jumpToHeading(editor, target)
      }
    }
    const onLocationChange = () => synchronize()
    window.addEventListener('hashchange', onLocationChange)
    synchronize()
    const unregister = mergeRegister(
      editor.registerRootListener((root) => {
        if (root) synchronize()
      }),
      editor.registerUpdateListener(
        ({ editorState, dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size || dirtyLeaves.size) synchronize(editorState)
        },
      ),
    )
    return () => {
      unregister()
      window.removeEventListener('hashchange', onLocationChange)
      for (const element of anchors) {
        element.removeAttribute('id')
        element.removeAttribute('tabindex')
      }
    }
  }, [editor, ready, documentId])

  return null
}
