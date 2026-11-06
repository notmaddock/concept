// @vitest-environment node
import { expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { assetId, describeAsset } from './assets'
import {
  IncompleteAssetsError,
  readPackage,
  snapshotRevision,
  writePackage,
} from './package'
import type { NormalizedSnapshot } from './package'
import {
  registerAssetReferenceCollector,
  assetReferenceField,
} from './references'
import { serializeConcept } from './serialization'

function documentSnapshot(): NormalizedSnapshot {
  const doc = new Doc()
  doc.get('root', XmlText).insert(0, 'Hello 🌎 — café')
  const update = encodeStateAsUpdate(doc)
  doc.destroy()
  return { name: 'Résumé 日本語', update, assets: [], requiredFeatures: [] }
}
async function withAssets() {
  const snapshot = documentSnapshot()
  for (const bytes of [
    new TextEncoder().encode('plain bytes'),
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
  ]) {
    const blob = new Blob([bytes])
    snapshot.assets.push({ descriptor: await describeAsset(blob), blob })
  }
  return snapshot
}
async function rewrite(
  snapshot: NormalizedSnapshot,
  change: (files: Record<string, Uint8Array>) => void,
) {
  const files = unzipSync(await writePackage(snapshot))
  change(files)
  return zipSync(files, { level: 0 })
}
function manifest(
  files: Record<string, Uint8Array>,
  change: (value: Record<string, unknown>) => void,
) {
  const value = JSON.parse(
    new TextDecoder().decode(files['manifest.json']),
  ) as Record<string, unknown>
  change(value)
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(value))
}

it('round trips generic binary assets, Unicode names, and legacy state into v2 packages', async () => {
  const snapshot = await withAssets()
  const result = await readPackage(await writePackage(snapshot))
  expect(result.kind).toBe('complete')
  if (result.kind !== 'complete') throw new Error('Expected complete')
  expect(result.snapshot.name).toBe(snapshot.name)
  expect(await snapshotRevision(result.snapshot)).toBe(
    await snapshotRevision(snapshot),
  )
  const doc = new Doc()
  applyUpdate(doc, result.snapshot.update)
  expect(doc.get('root', XmlText).toString()).toBe('Hello 🌎 — café')
  const legacy = new TextEncoder().encode(serializeConcept(snapshot.name, doc))
  expect((await readPackage(legacy)).kind).toBe('complete')
  doc.destroy()
})

it('revisions ignore ZIP ordering and timestamps and canonicalize asset ordering', async () => {
  const snapshot = await withAssets()
  const bytes = await writePackage(snapshot)
  const entries = unzipSync(bytes)
  const reordered = zipSync(
    Object.fromEntries(Object.entries(entries).reverse()),
    { level: 0, mtime: new Date('2001-01-01') },
  )
  const result = await readPackage(reordered)
  expect(result.kind).toBe('complete')
  if (result.kind !== 'complete') throw new Error('Expected complete')
  expect(await snapshotRevision(result.snapshot)).toBe(
    await snapshotRevision({
      ...snapshot,
      assets: [...snapshot.assets].reverse(),
    }),
  )
})

it('returns an explicit recovery result for absent declared payloads', async () => {
  const snapshot = await withAssets()
  const missing = snapshot.assets[0].descriptor.id
  const bytes = await rewrite(snapshot, (files) => {
    delete files[`assets/${missing.slice(7)}`]
  })
  const result = await readPackage(bytes)
  expect(result.kind).toBe('incomplete')
  if (result.kind !== 'incomplete') throw new Error('Expected incomplete')
  expect(result.missingAssets).toEqual([missing])
  expect(result.snapshot.assets).toHaveLength(1)
})

it('rejects undeclared entries, wrong payloads, duplicate descriptors, and wrong document hashes', async () => {
  const snapshot = await withAssets()
  const path = `assets/${snapshot.assets[0].descriptor.id.slice(7)}`
  for (const change of [
    (files: Record<string, Uint8Array>) => {
      files[`assets/${'f'.repeat(64)}`] = new Uint8Array([1])
    },
    (files: Record<string, Uint8Array>) => {
      files[path] = new Uint8Array([1])
    },
    (files: Record<string, Uint8Array>) =>
      manifest(files, (value) => {
        const assets = value.assets as unknown[]
        assets.push(assets[0])
      }),
    (files: Record<string, Uint8Array>) =>
      manifest(files, (value) => {
        ;(value.document as Record<string, unknown>).sha256 =
          `sha256:${'f'.repeat(64)}`
      }),
    (files: Record<string, Uint8Array>) => {
      files['../manifest.json'] = files['manifest.json']
    },
  ])
    await expect(readPackage(await rewrite(snapshot, change))).rejects.toThrow()
})

it('reports unsupported capabilities and versions without normalizing away their semantics', async () => {
  const snapshot = documentSnapshot()
  expect(
    await readPackage(
      await rewrite(snapshot, (files) =>
        manifest(files, (value) => {
          value.requiredFeatures = ['future-asset-semantics']
        }),
      ),
    ),
  ).toEqual({
    kind: 'unsupported',
    reason: 'features',
    version: 2,
    features: ['future-asset-semantics'],
  })
  expect(
    await readPackage(
      await rewrite(snapshot, (files) =>
        manifest(files, (value) => {
          value.version = 3
        }),
      ),
    ),
  ).toEqual({
    kind: 'unsupported',
    reason: 'version',
    version: 3,
    features: [],
  })
})

it('enforces configurable input, expanded, entry and manifest limits before decompression', async () => {
  const bytes = await writePackage(await withAssets())
  for (const limits of [
    { packageBytes: 10 },
    { expandedBytes: 10 },
    { entries: 2 },
    { manifestBytes: 10 },
    { assetBytes: 2 },
  ])
    await expect(readPackage(bytes, { limits })).rejects.toThrow()
  const files = unzipSync(await writePackage(documentSnapshot()))
  files['document.yjs'] = new Uint8Array(100_000)
  await expect(
    readPackage(zipSync(files, { level: 9 }), {
      limits: { expansionRatio: 2 },
    }),
  ).rejects.toThrow('expansion')
})

it('blocks publishing absent references and returns their IDs for recovery', async () => {
  const doc = new Doc()
  const node = new XmlText()
  const id = await assetId(new Uint8Array([1, 2, 3]))
  node.setAttribute('__type', 'test-attachment')
  node.setAttribute('__assetId', id)
  doc.get('root', XmlText).insertEmbed(0, node)
  const unregister = registerAssetReferenceCollector(
    'test-attachment',
    (persisted) => assetReferenceField(persisted, '__assetId'),
  )
  try {
    const snapshot = { ...documentSnapshot(), update: encodeStateAsUpdate(doc) }
    await expect(writePackage(snapshot)).rejects.toBeInstanceOf(
      IncompleteAssetsError,
    )
  } finally {
    unregister()
    doc.destroy()
  }
})

it('rejects invalid Yjs, corrupt CRCs, duplicate paths, truncation, and cancellation', async () => {
  const snapshot = documentSnapshot()
  await expect(
    writePackage({ ...snapshot, update: new Uint8Array([255]) }),
  ).rejects.toThrow('Yjs')
  const bytes = await writePackage(snapshot)
  const corrupted = bytes.slice()
  corrupted[50] ^= 1
  await expect(readPackage(corrupted)).rejects.toThrow()
  await expect(
    readPackage(bytes.subarray(0, bytes.length - 1)),
  ).rejects.toThrow()
  const abort = new AbortController()
  abort.abort()
  await expect(readPackage(bytes, { signal: abort.signal })).rejects.toThrow()
  const files = unzipSync(bytes)
  const duplicate = zipSync(
    {
      'manifest.json': files['manifest.json'],
      'document.yjs': files['document.yjs'],
      'manifest.jsoX': files['manifest.json'],
    },
    { level: 0 },
  )
  for (let i = 0; i < duplicate.length - 13; i++)
    if (
      new TextDecoder().decode(duplicate.subarray(i, i + 13)) ===
      'manifest.jsoX'
    )
      duplicate[i + 12] = 'n'.charCodeAt(0)
  await expect(readPackage(duplicate)).rejects.toThrow('duplicate')
})

it('blocks unknown persisted node semantics for both legacy and ZIP inputs', async () => {
  const doc = new Doc()
  const node = new XmlText()
  node.setAttribute('__type', 'future-unknown-node')
  doc.get('root', XmlText).insertEmbed(0, node)
  try {
    const legacy = new TextEncoder().encode(serializeConcept('Future', doc))
    expect(await readPackage(legacy)).toMatchObject({
      kind: 'unsupported',
      reason: 'features',
      features: ['node:future-unknown-node'],
    })
    const update = encodeStateAsUpdate(doc)
    const bytes = await rewrite(documentSnapshot(), (files) => {
      files['document.yjs'] = update
      manifest(files, (value) => {
        ;(value.document as Record<string, unknown>).byteLength = update.length
      })
    })
    const files = unzipSync(bytes)
    const hash = await assetId(update)
    manifest(files, (value) => {
      ;(value.document as Record<string, unknown>).sha256 = hash
    })
    expect(await readPackage(zipSync(files, { level: 0 }))).toMatchObject({
      kind: 'unsupported',
      reason: 'features',
      features: ['node:future-unknown-node'],
    })
  } finally {
    doc.destroy()
  }
})

it('rejects unsafe lengths and malformed asset identities rather than recovering hostile manifests', async () => {
  const snapshot = await withAssets()
  for (const change of [
    (value: Record<string, unknown>) => {
      ;(value.assets as Record<string, unknown>[])[0].byteLength =
        Number.MAX_SAFE_INTEGER + 1
    },
    (value: Record<string, unknown>) => {
      ;(value.assets as Record<string, unknown>[])[0].byteLength = -1
    },
    (value: Record<string, unknown>) => {
      ;(value.assets as Record<string, unknown>[])[0].id =
        `sha256:${'A'.repeat(64)}`
    },
  ])
    await expect(
      readPackage(await rewrite(snapshot, (files) => manifest(files, change))),
    ).rejects.toThrow('descriptor')
})

it('reads compressed ZIP entries and hard-fails malformed deflate streams', async () => {
  const snapshot = await withAssets()
  const stored = await writePackage(snapshot)
  expect(
    (await readPackage(zipSync(unzipSync(stored), { level: 6 }))).kind,
  ).toBe('complete')
  const compressed = zipSync(unzipSync(stored), { level: 6 })
  const view = new DataView(compressed.buffer)
  const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true)
  compressed[payload] = 0xff
  await expect(readPackage(compressed)).rejects.toThrow('compression')
})
