import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { $createParagraphNode, $getNodeByKey } from 'lexical'
import type { NodeKey } from 'lexical'
import {
  imageDimensionLimit,
  imageMinimumDisplayWidth,
} from '#/lib/documents/image-schema'
import type { ImageSource } from '#/lib/documents/image-schema'
import { Button } from '#/components/ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '#/components/ui/context-menu'
import { ImageOptionsDialog } from '../images/ImageOptionsDialog'
import { useDocumentAsset } from '../media/use-document-asset'
import { useDocumentMedia } from '../media/document-media-context'
import { useRenderableImage } from '../images/use-renderable-image'
import { updateImageEdit } from '../images/image-edit'
import { REPLACE_IMAGE_COMMAND } from '../images/commands'
import { $isImageNode } from './ImageNode'
import type { ImageNode } from './ImageNode'

export function ImageBlock({
  nodeKey,
  source,
  altText,
  displayWidth,
}: {
  nodeKey: NodeKey
  source: ImageSource
  altText: string
  displayWidth: number | null
}) {
  const [editor] = useLexicalComposerContext()
  const editable = useLexicalEditable()
  const media = useDocumentMedia()
  const [selected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey)
  const { state: resolution, retry } = useDocumentAsset(source.assetId)
  const { url, failure } = useRenderableImage(
    resolution.state === 'available' ? resolution.blob : undefined,
    source,
  )
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<number>()
  const blockRef = useRef<HTMLDivElement>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
  useEffect(() => {
    setFailed(false)
  }, [url])
  useEffect(() => {
    if (!editable) cancelGesture.current?.()
    return () => cancelGesture.current?.()
  }, [editable])
  const canEdit = editable && Boolean(media?.canEdit())
  function mutate(change: (node: ImageNode) => void) {
    if (!editor.isEditable() || !media?.canEdit()) return
    updateImageEdit(editor, () => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageNode(node)) change(node)
    })
  }
  const available = url && !failed && !failure
  const status =
    failed || failure
      ? 'Image cannot be decoded'
      : resolution.state === 'unavailable'
        ? 'Image unavailable'
        : 'Loading image'
  return (
    <div className="my-3 max-w-full" contentEditable={false}>
      <ContextMenu>
        <ContextMenuTrigger
          render={<div />}
          ref={blockRef}
          role="button"
          tabIndex={0}
          aria-label={altText ? `Image: ${altText}` : 'Image'}
          aria-pressed={selected}
          className={`relative max-w-full outline-offset-2 ${selected ? 'outline-2 outline-primary' : ''}`}
          style={{
            width: preview ?? displayWidth ?? source.intrinsicWidth,
            aspectRatio: `${source.intrinsicWidth} / ${source.intrinsicHeight}`,
          }}
          onClick={(event) => {
            event.preventDefault()
            clearSelection()
            setSelected(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canEdit) {
              event.preventDefault()
              event.stopPropagation()
              mutate((node) => {
                const paragraph = $createParagraphNode()
                node.insertAfter(paragraph)
                paragraph.selectStart()
              })
              editor.focus()
              return
            }
            if (event.key === ' ') {
              event.preventDefault()
              clearSelection()
              setSelected(true)
            }
          }}
        >
          {available ? (
            <img
              src={url}
              alt={altText}
              draggable={false}
              className="block h-full w-full object-contain"
              onError={() => setFailed(true)}
              onLoad={(event) => {
                const image = event.currentTarget
                if (
                  image.naturalWidth !== source.intrinsicWidth ||
                  image.naturalHeight !== source.intrinsicHeight
                )
                  setFailed(true)
              }}
            />
          ) : (
            <div
              className="flex h-full min-h-16 w-full items-center justify-center gap-2 rounded bg-muted p-3 text-sm text-muted-foreground"
              role="status"
            >
              <span>
                {status}
                {altText ? `: ${altText}` : ''}
              </span>
              {resolution.state === 'unavailable' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    void retry()
                  }}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {selected && canEdit && (
            <button
              type="button"
              aria-label="Resize image"
              className="absolute -right-1 -bottom-1 size-4 cursor-se-resize rounded-sm border-2 border-background bg-primary touch-none"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                cancelGesture.current?.()
                const startX = event.clientX
                const initialWidth =
                  blockRef.current?.getBoundingClientRect().width ??
                  source.intrinsicWidth
                let width = initialWidth
                const maxWidth =
                  blockRef.current?.parentElement?.clientWidth ?? initialWidth
                const cleanup = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', finish)
                  window.removeEventListener('pointercancel', cancel)
                  window.removeEventListener('keydown', key)
                  setPreview(undefined)
                  cancelGesture.current = null
                }
                const move = (pointer: PointerEvent) => {
                  width = Math.max(
                    imageMinimumDisplayWidth,
                    Math.min(maxWidth, initialWidth + pointer.clientX - startX),
                  )
                  setPreview(width)
                }
                const finish = () => {
                  cleanup()
                  mutate((node) => node.setDisplayWidth(width))
                }
                const cancel = () => cleanup()
                const key = (keyboard: KeyboardEvent) => {
                  if (keyboard.key === 'Escape') {
                    keyboard.preventDefault()
                    cancel()
                  }
                }
                cancelGesture.current = cancel
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', finish)
                window.addEventListener('pointercancel', cancel)
                window.addEventListener('keydown', key)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  event.stopPropagation()
                  mutate((node) =>
                    node.setDisplayWidth(
                      Math.min(
                        imageDimensionLimit,
                        Math.max(
                          imageMinimumDisplayWidth,
                          (node.getDisplayWidth() ?? source.intrinsicWidth) +
                            (event.key === 'ArrowRight' ? 10 : -10),
                        ),
                      ),
                    ),
                  )
                }
              }}
            />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setOptionsOpen(true)}>
            Image Options
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ImageOptionsDialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        source={source}
        altText={altText}
        displayWidth={displayWidth}
        byteLength={
          resolution.state === 'available' ? resolution.blob.size : undefined
        }
        canEdit={canEdit}
        mutate={mutate}
        onReplace={() => {
          setOptionsOpen(false)
          if (editor.isEditable() && media?.canEdit())
            editor.dispatchCommand(REPLACE_IMAGE_COMMAND, nodeKey)
        }}
      />
    </div>
  )
}
