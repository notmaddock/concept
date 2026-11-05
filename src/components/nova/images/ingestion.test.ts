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

function png(width = 2, height = 3) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new Blob([bytes])
}

it('uses decoded orientation, preserves bytes, and releases temporary URLs', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const revoke = vi.fn()
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:image',
    revokeObjectURL: revoke,
  })
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      naturalWidth = 3
      naturalHeight = 2
      decode = async () => {}
    },
  )
  const source = png()
  const result = await prepareImage(source)
  expect(result.width).toBe(3)
  expect(result.height).toBe(2)
  expect(result.blob.type).toBe('image/png')
  expect(await result.blob.arrayBuffer()).toEqual(await source.arrayBuffer())
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:image')
})

it('releases the temporary URL when browser decoding fails', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const revoke = vi.fn()
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:image',
    revokeObjectURL: revoke,
  })
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = async () => {
        throw new Error('invalid payload')
      }
    },
  )
  await expect(prepareImage(png())).rejects.toMatchObject({ code: 'decode' })
  expect(revoke).toHaveBeenCalledOnce()
})

it('rejects APNG animation work from declared frames before decoding', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const bytes = new Uint8Array(52)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 0)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, 2)
  view.setUint32(20, 3)
  view.setUint32(8, 12)
  view.setUint32(32, 8)
  bytes.set([97, 99, 84, 76], 36)
  view.setUint32(40, imageLimits.animationFrames + 1)
  const decoder = vi.fn()
  vi.stubGlobal('Image', decoder)
  await expect(prepareImage(new Blob([bytes]))).rejects.toMatchObject({
    code: 'dimensions',
  })
})
