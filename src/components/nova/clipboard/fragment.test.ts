import { describe, expect, it } from 'vitest'
import {
  fragmentHtml,
  fragmentReferences,
  parseImageFragment,
} from './fragment'
import { imageDataBlob, imageDataUrl } from '#/lib/documents/image-transfer'

const id = `sha256:${'a'.repeat(64)}`
const image = {
  type: 'image',
  version: 1,
  source: { assetId: id, intrinsicWidth: 12, intrinsicHeight: 8 },
  altText: 'Example',
  displayWidth: 100,
}
const paragraph = {
  type: 'paragraph',
  version: 1,
  children: [{ type: 'text', version: 1, text: 'before' }],
}

describe('portable image fragments', () => {
  it('preserves nested structure, repeated placements and explicit missing bytes', () => {
    const nodes = [
      paragraph,
      {
        type: 'quote',
        version: 1,
        children: [image, { ...image, altText: 'Another placement' }],
      },
      paragraph,
    ]
    const fragment = parseImageFragment(
      JSON.stringify({ version: 1, nodes, assets: { [id]: null } }),
    )
    expect(fragment.nodes).toEqual(nodes)
    expect(fragmentReferences(fragment.nodes).size).toBe(1)
    const html = fragmentHtml('<p>before</p><p>after</p>', fragment)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.body.textContent).toBe('beforeafter')
    expect(
      parseImageFragment(
        document
          .querySelector('[data-concept-fragment]')!
          .getAttribute('data-concept-fragment')!,
      ),
    ).toEqual(fragment)
  })

  it('rejects undeclared, unrelated or invalid image references', () => {
    for (const assets of [
      {},
      { [id]: null, [`sha256:${'b'.repeat(64)}`]: null },
      { [id]: 42 },
    ])
      expect(() =>
        parseImageFragment(
          JSON.stringify({ version: 1, nodes: [image], assets }),
        ),
      ).toThrow()
    expect(() =>
      fragmentReferences([
        Object.assign({}, image, {
          source: { ...image.source, assetId: 'url' },
        }),
      ]),
    ).toThrow()
    expect(() => fragmentReferences([{ ...image, version: 2 }])).toThrow()
  })

  it('bounds nesting before constructing editor nodes', () => {
    let node = { ...paragraph }
    for (let i = 0; i < 70; i++)
      node = { ...paragraph, children: [node] as never }
    expect(() => fragmentReferences([node])).toThrow('complex')
  })

  it('only decodes bounded supported data images', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    })
    const restored = imageDataBlob(await imageDataUrl(blob))
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(
      new Uint8Array(await blob.arrayBuffer()),
    )
    expect(() => imageDataBlob('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
    expect(() => imageDataBlob('https://example.com/image.png')).toThrow()
  })
})
