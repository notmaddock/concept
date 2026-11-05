import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createRangeSelection,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
  HISTORY_PUSH_TAG,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical'
import type { NodeKey } from 'lexical'
import { toast } from 'sonner'
import { useDocumentMedia } from '../media/document-media-context'
import { $createImageNode, $isImageNode } from '../nodes/ImageNode'
import { prepareImages } from './ingestion'
import { captureImageBookmark, restoreImageBookmark } from './bookmark'
import type { ImageBookmark } from './bookmark'
import {
  INSERT_IMAGE_COMMAND,
  INSERT_IMAGE_FILES_COMMAND,
  REPLACE_IMAGE_COMMAND,
} from './commands'
import { $insertImageBlocks } from './insert-blocks'
import { updateImageEdit } from './image-edit'
import { hasImageDrop, imageDropRange } from './drop'

export function ImagePlugin() {
  const [editor] = useLexicalComposerContext()
  const media = useDocumentMedia()
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef<{
    bookmark: ImageBookmark | null
    replacement?: NodeKey
  }>(null)

  useEffect(() => {
    if (!media) return
    const session = media
    async function ingest(
      files: File[],
      target: NonNullable<typeof pending.current>,
    ) {
      try {
        if (!session.canEdit() || !editor.isEditable())
          throw new Error('This document is read-only.')
        const { images, rejected } = await prepareImages(files, session.signal)
        if (!images.length)
          throw rejected[0] instanceof Error
            ? rejected[0]
            : new Error('No supported images were selected.')
        const outcome = await session.insert(
          images.map((image) => image.blob),
          (descriptors) => {
            if (!editor.isEditable() || !session.canEdit())
              throw new Error('This document is read-only.')
            let commitError: Error | undefined
            updateImageEdit(
              editor,
              () => {
                try {
                  if (target.replacement) {
                    const node = $getNodeByKey(target.replacement)
                    if (!$isImageNode(node))
                      throw new Error(
                        'The image was removed before replacement finished.',
                      )
                    const image = images[0]
                    node.setSource({
                      assetId: descriptors[0].id,
                      intrinsicWidth: image.width,
                      intrinsicHeight: image.height,
                    })
                  } else {
                    if (!target.bookmark)
                      throw new Error('Choose a text position for the image.')
                    restoreImageBookmark(target.bookmark)
                    $insertImageBlocks(
                      images.map((image, index) =>
                        $createImageNode({
                          assetId: descriptors[index].id,
                          intrinsicWidth: image.width,
                          intrinsicHeight: image.height,
                        }),
                      ),
                    )
                  }
                } catch (error) {
                  commitError =
                    error instanceof Error
                      ? error
                      : new Error('Could not insert the images.')
                }
              },
              {
                discrete: true,
                tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG],
              },
            )
            if (commitError) throw commitError
          },
        )
        if (outcome.status === 'durability-failed')
          toast.error(
            'Images were inserted, but saving failed. Keep this document open and retry saving.',
          )
        else if (rejected.length)
          toast.warning(
            `${rejected.length} image${rejected.length === 1 ? '' : 's'} could not be inserted.`,
          )
      } catch (error) {
        if (session.signal.aborted) return
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not insert the images.',
        )
      }
    }
    const unregister = [
      editor.registerCommand(
        INSERT_IMAGE_COMMAND,
        () => {
          if (!session.canEdit() || !editor.isEditable()) return false
          pending.current = { bookmark: captureImageBookmark(editor) }
          if (!pending.current.bookmark) {
            toast.error('Choose a text position for the image.')
            return true
          }
          input.current?.click()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        REPLACE_IMAGE_COMMAND,
        (replacement) => {
          if (!session.canEdit() || !editor.isEditable()) return false
          pending.current = { bookmark: null, replacement }
          input.current?.click()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        INSERT_IMAGE_FILES_COMMAND,
        (files) => {
          const bookmark = captureImageBookmark(editor)
          void ingest(files, { bookmark })
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        DRAGOVER_COMMAND,
        (event) => {
          if (
            !session.canEdit() ||
            !event.dataTransfer ||
            event.dataTransfer.types.includes(
              'application/x-lexical-drag-block',
            ) ||
            !hasImageDrop(event.dataTransfer)
          )
            return false
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          const transfer = event.dataTransfer
          if (
            !session.canEdit() ||
            !editor.isEditable() ||
            !transfer?.files.length
          )
            return false
          if (transfer.types.includes('application/x-lexical-drag-block'))
            return false
          const files = Array.from(transfer.files)
          if (!hasImageDrop(transfer)) return false
          event.preventDefault()
          const owner = editor.getRootElement()?.ownerDocument
          const range = owner
            ? imageDropRange(owner, event.clientX, event.clientY)
            : null
          if (!range) {
            toast.error('Choose a text position for the image.')
            return true
          }
          const node = $getNearestNodeFromDOMNode(range.startContainer)
          if (!node || !editor.getRootElement()?.contains(range.startContainer))
            return true
          const selection = $createRangeSelection()
          if ($isTextNode(node))
            selection.anchor.set(
              node.getKey(),
              Math.min(range.startOffset, node.getTextContentSize()),
              'text',
            )
          else if ($isElementNode(node))
            selection.anchor.set(
              node.getKey(),
              Math.min(range.startOffset, node.getChildrenSize()),
              'element',
            )
          else return true
          selection.focus.set(
            selection.anchor.key,
            selection.anchor.offset,
            selection.anchor.type,
          )
          $setSelection(selection)
          // Dispatch after the drop selection has committed so the bookmark sees it.
          queueMicrotask(() =>
            editor.dispatchCommand(INSERT_IMAGE_FILES_COMMAND, files),
          )
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      ...[KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND].map((command) =>
        editor.registerCommand(
          command,
          (event) => {
            if (!editor.isEditable() || !session.canEdit()) return false
            const selection = $getSelection()
            if (!$isNodeSelection(selection)) return false
            const images = selection.getNodes().filter($isImageNode)
            if (!images.length) return false
            event.preventDefault()
            updateImageEdit(editor, () =>
              images.forEach((node) => node.remove()),
            )
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!editor.isEditable() || !session.canEdit()) return false
          const selection = $getSelection()
          if (!$isNodeSelection(selection)) return false
          const node = selection.getNodes().find($isImageNode)
          if (!node) return false
          event?.preventDefault()
          const paragraph = $createParagraphNode()
          updateImageEdit(editor, () => {
            node.insertAfter(paragraph)
            paragraph.selectStart()
          })
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ]
    const element = input.current
    const change = () => {
      const files = Array.from(element?.files ?? [])
      const target = pending.current
      pending.current = null
      if (element) element.value = ''
      if (files.length && target)
        void ingest(target.replacement ? files.slice(0, 1) : files, target)
    }
    element?.addEventListener('change', change)
    return () => {
      unregister.forEach((stop) => stop())
      element?.removeEventListener('change', change)
      pending.current = null
    }
  }, [editor, media])
  return media ? (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      hidden
      aria-label="Choose images"
    />
  ) : null
}
