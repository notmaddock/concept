import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import {
  $generateJSONFromSelectedNodes,
  $generateNodesFromSerializedNodes,
  $insertGeneratedNodes,
} from '@lexical/clipboard'
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  PASTE_COMMAND,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical'
import type { BaseSerializedNode } from '@lexical/clipboard'
import type { ImageBookmark } from '../images/bookmark'
import { toast } from 'sonner'
import { useDocumentMedia } from '../media/document-media-context'
import { captureImageBookmark, restoreImageBookmark } from '../images/bookmark'
import { INSERT_IMAGE_FILES_COMMAND } from '../images/commands'
import { prepareImage } from '../images/ingestion'
import { updateImageEdit } from '../images/image-edit'
import {
  embedImageData,
  imageTransferLimits,
  imageDataBlob,
  resolveImageData,
} from '#/lib/documents/image-transfer'
import { assetId } from '#/lib/documents/assets'
import { documentAssets } from '#/lib/documents/working'
import {
  fragmentHtml,
  fragmentReferences,
  parseImageFragment,
  UnsupportedFragmentVersionError,
} from './fragment'
import { prepareHtmlImages, sanitizedHtml } from './html'

export function ImageClipboardPlugin() {
  const [editor] = useLexicalComposerContext()
  const media = useDocumentMedia()
  useEffect(() => {
    if (!media) return
    const report = (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not transfer clipboard content.',
      )
    const updateAtBookmark = (bookmark: ImageBookmark, commit: () => void) => {
      let failure: unknown
      updateImageEdit(
        editor,
        () => {
          try {
            restoreImageBookmark(bookmark)
            commit()
          } catch (error) {
            failure = error
          }
        },
        { discrete: true, tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] },
      )
      if (failure)
        throw failure instanceof Error
          ? failure
          : new Error('Could not insert clipboard content.')
    }
    const copy = (
      event: ClipboardEvent | KeyboardEvent | null,
      cut: boolean,
    ) => {
      const snapshot = editor.getEditorState()
      const captured = snapshot.read(
        () => {
          const selection = $getSelection()
          if (!selection) return null
          const { nodes } = $generateJSONFromSelectedNodes<BaseSerializedNode>(
            editor,
            selection,
          )
          const ids = fragmentReferences(nodes)
          if (!ids.size) return null
          return {
            nodes,
            ids,
            html: $generateHtmlFromNodes(editor, selection),
            text: selection.getTextContent(),
          }
        },
        { editor },
      )
      if (!captured) return false
      event?.preventDefault()
      const bookmark = captureImageBookmark(editor)
      let unavailable = false
      const prepare = async () => {
        const data = await resolveImageData(captured.ids, media.resolver, true)
        unavailable = [...data.values()].some((value) => value === null)
        const assets = Object.fromEntries(data)
        return fragmentHtml(embedImageData(captured.html, data), {
          version: 1,
          nodes: captured.nodes,
          assets,
        })
      }
      const clipboard = (navigator as { clipboard?: Clipboard }).clipboard
      if (
        typeof ClipboardItem === 'undefined' ||
        typeof clipboard?.write !== 'function'
      ) {
        report(
          new Error(
            'This browser cannot copy embedded images. Download a Concept document instead.',
          ),
        )
        return true
      }
      let pin: { release: () => void } | undefined
      try {
        pin = documentAssets(media.doc)?.pin(captured.ids)
      } catch (error) {
        report(error)
        return true
      }
      // Promise-backed items preserve the user activation while durable bytes load.
      const html = prepare().then(
        (value) => new Blob([value], { type: 'text/html' }),
      )
      void html.catch(() => {})
      let write: Promise<void>
      try {
        write = clipboard.write([
          new ClipboardItem({
            'text/html': html,
            'text/plain': new Blob([captured.text], { type: 'text/plain' }),
          }),
        ])
      } catch (error) {
        void html.finally(() => pin?.release()).catch(() => {})
        report(error)
        return true
      }
      void Promise.allSettled([html, write]).then(() => pin?.release())
      void write
        .then(() => {
          if (unavailable)
            toast.info(
              'Some copied images are unavailable. Their placements were preserved.',
            )
          if (
            !cut ||
            !bookmark ||
            !media.canEdit() ||
            !media.isAlive() ||
            editor.getEditorState() !== snapshot
          )
            return
          updateAtBookmark(bookmark, () => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selection.removeText()
            else if ($isNodeSelection(selection))
              selection.getNodes().forEach((node) => node.remove())
          })
          void media.flush().then(media.requestSave).catch(report)
        })
        .catch(report)
      return true
    }
    const cleanups = [
      editor.registerCommand(
        COPY_COMMAND,
        (event) => copy(event, false),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        CUT_COMMAND,
        (event) => copy(event, true),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (
            !(event instanceof ClipboardEvent) ||
            !event.clipboardData ||
            !editor.isEditable()
          )
            return false
          const html = event.clipboardData.getData('text/html')
          if (!html) {
            const files = [...event.clipboardData.files]
            if (!files.length) {
              if (
                event.clipboardData
                  .getData('application/x-lexical-editor')
                  .includes('"type":"image"')
              ) {
                event.preventDefault()
                report(
                  new Error(
                    'Clipboard images have no portable bytes. Copy again or use a Concept document.',
                  ),
                )
                return true
              }
              return false
            }
            event.preventDefault()
            editor.dispatchCommand(INSERT_IMAGE_FILES_COMMAND, files)
            return true
          }
          const bookmark = captureImageBookmark(editor)
          if (!bookmark) return false
          event.preventDefault()
          const paste = async () => {
            const document = sanitizedHtml(html)
            const encoded = document
              .querySelector('[data-concept-fragment]')
              ?.getAttribute('data-concept-fragment')
            let missing = false
            let unsupported = 0
            let commit: () => void
            const blobs: Blob[] = []
            let compatibilityFallback = false
            const fragment = (() => {
              if (!encoded) return null
              try {
                return parseImageFragment(encoded)
              } catch (error) {
                if (!(error instanceof UnsupportedFragmentVersionError))
                  throw error
                compatibilityFallback = true
                return null
              }
            })()
            if (fragment) {
              // Parse every registered node before obtaining destination ownership.
              editor.parseEditorState({
                root: {
                  type: 'root',
                  version: 1,
                  children: fragment.nodes,
                  direction: null,
                  format: '',
                  indent: 0,
                },
              })
              let pixels = 0
              for (const id of fragmentReferences(fragment.nodes)) {
                const data = fragment.assets[id]
                if (data === null) {
                  missing = true
                  continue
                }
                const prepared = await prepareImage(
                  imageDataBlob(data),
                  media.signal,
                )
                pixels += prepared.width * prepared.height
                if (pixels > imageTransferLimits.pixels)
                  throw new Error('Too many clipboard image pixels.')
                if ((await assetId(await prepared.blob.arrayBuffer())) !== id)
                  throw new Error('Clipboard image integrity check failed.')
                blobs.push(prepared.blob)
              }
              commit = () => {
                const selection = $getSelection()
                if (selection)
                  $insertGeneratedNodes(
                    editor,
                    $generateNodesFromSerializedNodes(fragment.nodes),
                    selection,
                  )
              }
            } else {
              const prepared = await prepareHtmlImages(document, media.signal)
              unsupported = prepared.unsupported
              blobs.push(...prepared.images.map((image) => image.blob))
              commit = () => {
                const selection = $getSelection()
                if (selection)
                  $insertGeneratedNodes(
                    editor,
                    $generateNodesFromDOM(editor, document),
                    selection,
                  )
              }
              const result = await media.insert(blobs, (descriptors) => {
                prepared.images.forEach((image, index) => {
                  image.element.setAttribute(
                    'data-concept-image-source',
                    JSON.stringify({
                      assetId: descriptors[index].id,
                      intrinsicWidth: image.intrinsicWidth,
                      intrinsicHeight: image.intrinsicHeight,
                    }),
                  )
                })
                updateAtBookmark(bookmark, commit)
              })
              if (result.status === 'durability-failed') report(result.error)
              if (compatibilityFallback)
                toast.info(
                  'This clipboard version is newer. Pasted the supported HTML representation.',
                )
              else if (unsupported)
                toast.info('External images were pasted as alt text.')
              return
            }
            const result = await media.insert(blobs, () => {
              updateAtBookmark(bookmark, commit)
            })
            if (result.status === 'durability-failed') report(result.error)
            if (missing)
              toast.info(
                'Some pasted images are unavailable. Replace or remove them to complete saving.',
              )
          }
          void paste().catch(report)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [editor, media])
  return null
}
