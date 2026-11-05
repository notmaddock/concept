import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { imageLimits, prepareImage, prepareImages } from './ingestion'

afterEach(() => vi.unstubAllGlobals())

it('rejects disguised unsupported payloads without creating a decoder', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const decoder = vi.fn()
  vi.stubGlobal('Image', decoder)
  await expect(
    prepareImage(new Blob(['<svg></svg>'], { type: 'image/png' })),
  ).rejects.toMatchObject({ code: 'unsupported' })
  expect(decoder).not.toHaveBeenCalled()
})

it('checks dimensions from headers before browser decoding', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, imageLimits.dimension + 1)
  view.setUint32(20, 1)
  const decoder = vi.fn()
  vi.stubGlobal('Image', decoder)
  await expect(prepareImage(new Blob([bytes]))).rejects.toMatchObject({
    code: 'dimensions',
  })
  expect(decoder).not.toHaveBeenCalled()
})

it('bounds file count before any payload is read', async () => {
  await expect(
    prepareImages(
      Array.from({ length: imageLimits.files + 1 }, () => new Blob()),
    ),
  ).rejects.toMatchObject({ code: 'count' })
})
