import { useEffect, useState } from 'react'
import { useAssetObjectUrl } from '../media/use-document-asset'
import { prepareImage } from './ingestion'
import type { ImageSource } from '#/lib/documents/image-schema'

export type ImageRenderFailure =
  { kind: 'decode'; error: unknown } | { kind: 'metadata' }

export function useRenderableImage(
  blob: Blob | undefined,
  source: ImageSource,
) {
  const [result, setResult] = useState<{
    blob: Blob
    width: number
    height: number
    prepared?: Blob
    failure?: ImageRenderFailure
  }>()
  useEffect(() => {
    if (!blob) return
    const lifetime = new AbortController()
    void prepareImage(blob, lifetime.signal).then(
      (image) => {
        if (lifetime.signal.aborted) return
        setResult({
          blob,
          width: source.intrinsicWidth,
          height: source.intrinsicHeight,
          ...(image.width === source.intrinsicWidth &&
          image.height === source.intrinsicHeight
            ? { prepared: image.blob }
            : { failure: { kind: 'metadata' } }),
        })
      },
      (error: unknown) => {
        if (!lifetime.signal.aborted)
          setResult({
            blob,
            width: source.intrinsicWidth,
            height: source.intrinsicHeight,
            failure: { kind: 'decode', error },
          })
      },
    )
    return () => lifetime.abort()
  }, [blob, source.intrinsicWidth, source.intrinsicHeight])
  const current =
    result !== undefined &&
    result.blob === blob &&
    result.width === source.intrinsicWidth &&
    result.height === source.intrinsicHeight
      ? result
      : undefined
  const url = useAssetObjectUrl(current?.prepared)
  return { url, failure: current?.failure }
}
