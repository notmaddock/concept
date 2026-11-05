import { useEffect, useState } from 'react'
import type { AssetId } from '#/lib/documents/assets'
import { createAssetObjectUrl } from '#/lib/documents/asset-session'
import type { AssetResolution } from '#/lib/documents/asset-session'
import { useDocumentMedia } from './document-media-context'

export function useDocumentAsset(id: AssetId) {
  const media = useDocumentMedia()
  const resolver = media?.resolver
  const [resolved, setResolved] = useState<{
    id: AssetId
    resolver: typeof resolver
    value: AssetResolution
  }>()
  useEffect(() => {
    if (!resolver) return
    return resolver.subscribe(id, (value) =>
      setResolved({ id, resolver, value }),
    )
  }, [id, resolver])
  const state: AssetResolution =
    resolved?.id === id && resolved.resolver === resolver
      ? resolved.value
      : (resolver?.getState(id) ?? {
          state: 'unavailable',
          cause: { kind: 'missing' },
        })
  return { state, retry: () => resolver?.retry() }
}

export function useAssetObjectUrl(blob: Blob | undefined) {
  const [resource, setResource] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    const objectUrl = createAssetObjectUrl(blob)
    setResource({ blob, url: objectUrl.url })
    return () => objectUrl.dispose()
  }, [blob])
  return resource?.blob === blob ? resource?.url : undefined
}
