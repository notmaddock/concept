import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isHeadingNode } from '@lexical/rich-text'
import {
  $getNodeByKey,
  RootNode,
  SKIP_SCROLL_INTO_VIEW_TAG,
  mergeRegister,
} from 'lexical'
import type { LexicalEditor, NodeKey } from 'lexical'
import {
  documentIdFromHash,
  headingFragment,
  headingFromFragment,
} from '#/lib/documents/document-url'
import { $persistHeadingIds, $readOutline } from './outline'

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
  editable,
  documentId,
}: {
  ready: boolean
  editable: boolean
  documentId?: string
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!ready) return
    const synchronize = (state = editor.getEditorState()) => {
      const { pathname, hash } = window.location
      if (
        pathname === '/' &&
        documentId &&
        documentIdFromHash(hash.slice(1)) !== documentId
      )
        return
      const destination = headingFromFragment(hash)
      let target: NodeKey | undefined
      for (const { key, id } of state.read($readOutline)) {
        const element = editor.getElementByKey(key)
        if (!element) continue
        element.id = headingFragment(id, window.location)
        element.tabIndex = -1
        if (id === destination) target = key
      }
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
      editable
        ? editor.registerNodeTransform(RootNode, () => {
            if (editor.isEditable()) $persistHeadingIds()
          })
        : () => {},
    )
    return () => {
      unregister()
      window.removeEventListener('hashchange', onLocationChange)
    }
  }, [editor, editable, ready, documentId])

  return null
}
