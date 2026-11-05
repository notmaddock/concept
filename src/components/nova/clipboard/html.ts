import {
  imageDataBlob,
  imageTransferLimits,
} from '#/lib/documents/image-transfer'
import { prepareImage } from '../images/ingestion'

export function sanitizedHtml(content: string) {
  if (content.length > imageTransferLimits.bytes * 3)
    throw new Error('Clipboard content is too large.')
  const document = new DOMParser().parseFromString(content, 'text/html')
  document
    .querySelectorAll(
      'script,style,iframe,object,embed,template,link,meta,svg,math',
    )
    .forEach((node) => node.remove())
  let count = 0
  const visit = (element: Element, depth: number) => {
    if (
      ++count > imageTransferLimits.nodes ||
      depth > imageTransferLimits.depth
    )
      throw new Error('HTML is too complex.')
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith('on') ||
        ['srcset', 'srcdoc'].includes(attribute.name)
      )
        element.removeAttribute(attribute.name)
    }
    for (const child of element.children) visit(child, depth + 1)
  }
  visit(document.body, 0)
  return document
}

export async function prepareHtmlImages(
  document: Document,
  signal?: AbortSignal,
) {
  const elements = [...document.querySelectorAll('img')]
  if (elements.length > imageTransferLimits.assets)
    throw new Error('Too many embedded images.')
  const images: {
    element: HTMLImageElement
    blob: Blob
    intrinsicWidth: number
    intrinsicHeight: number
  }[] = []
  let unsupported = 0
  let bytes = 0
  let pixels = 0
  for (const element of elements) {
    const source = element.getAttribute('src') ?? ''
    element.removeAttribute('data-concept-image-source')
    element.removeAttribute('data-concept-image-asset-id')
    if (!source.startsWith('data:')) {
      element.replaceWith(
        document.createTextNode(
          element.alt ? `[Image: ${element.alt}]` : '[Image]',
        ),
      )
      unsupported++
      continue
    }
    const blob = imageDataBlob(source)
    bytes += blob.size
    if (bytes > imageTransferLimits.bytes)
      throw new Error('Embedded images are too large.')
    const prepared = await prepareImage(blob, signal)
    pixels += prepared.width * prepared.height
    if (pixels > imageTransferLimits.pixels)
      throw new Error('Too many embedded image pixels.')
    images.push({
      element,
      blob: prepared.blob,
      intrinsicWidth: prepared.width,
      intrinsicHeight: prepared.height,
    })
  }
  return { images, unsupported }
}
