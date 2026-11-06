import { Inflate, zipSync } from 'fflate'
import { applyUpdate, Doc } from 'yjs'
import { assetId, isAssetId, normalizeAssetMediaType } from './assets'
import type { AssetDescriptor, AssetId } from './assets'
import { packageLimits } from './limits'
import type { PackageLimits } from './limits'
import { collectReferences, UnsupportedNodeError } from './references'

export interface PackageAsset {
  descriptor: AssetDescriptor
  blob: Blob
}

export interface NormalizedSnapshot {
  name: string
  update: Uint8Array
  assets: PackageAsset[]
  requiredFeatures: string[]
}

export type PackageReadResult =
  | { kind: 'complete'; snapshot: NormalizedSnapshot }
  | {
      kind: 'incomplete'
      snapshot: NormalizedSnapshot
      missingAssets: AssetId[]
    }
  | {
      kind: 'unsupported'
      reason: 'version' | 'features'
      version: number
      features: string[]
    }

export class PackageValidationError extends Error {
  readonly code = 'invalid-package'
}

export class IncompleteAssetsError extends Error {
  readonly code = 'incomplete-assets'
  constructor(readonly missingAssets: readonly AssetId[]) {
    super(
      'Some document assets are unavailable. Recover them before saving or exporting.',
    )
  }
}

export interface PackageOptions {
  limits?: Partial<PackageLimits>
  signal?: AbortSignal
}

interface Manifest {
  format: 'concept'
  version: 2
  origin: 'Concept'
  name: string
  document: {
    path: 'document.yjs'
    encoding: 'yjs-update-v1'
    sha256: AssetId
    byteLength: number
  }
  assets: Array<AssetDescriptor & { path: string }>
  requiredFeatures: string[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const supportedFeatures = new Set<string>()
const fail = (message: string): never => {
  throw new PackageValidationError(message)
}
const checkSignal = (signal?: AbortSignal) => signal?.throwIfAborted()
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const length = (value: unknown, maximum: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= maximum
const pathFor = (id: AssetId) => `assets/${id.slice(7)}`
const compareIds = (a: AssetId, b: AssetId) => (a < b ? -1 : a > b ? 1 : 0)

function validateUpdate(update: Uint8Array, limits: PackageLimits) {
  if (update.byteLength > limits.documentBytes)
    fail('Document exceeds the size limit')
  const doc = new Doc()
  try {
    applyUpdate(doc, update)
    if (!doc.share.has('root')) fail('Missing document content')
  } catch (error) {
    if (error instanceof PackageValidationError) throw error
    fail('Invalid Yjs document')
  } finally {
    doc.destroy()
  }
}

function normalizeName(value: unknown, limits: PackageLimits): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limits.nameCharacters
  )
    return fail('Invalid document name')
  return value.trim()
}

function features(value: unknown, limits: PackageLimits): string[] {
  if (!Array.isArray(value) || value.length > limits.features)
    return fail('Invalid required features')
  const result: string[] = []
  for (const feature of value) {
    if (
      typeof feature !== 'string' ||
      !feature ||
      feature.length > limits.featureCharacters ||
      result.includes(feature)
    )
      fail('Invalid required feature')
    result.push(feature)
  }
  return result.sort()
}

function parseManifest(
  value: unknown,
  limits: PackageLimits,
): Manifest | Extract<PackageReadResult, { kind: 'unsupported' }> {
  if (
    !record(value) ||
    value.format !== 'concept' ||
    value.origin !== 'Concept' ||
    !Number.isSafeInteger(value.version)
  )
    return fail('Invalid Concept manifest')
  if (value.version !== 2)
    return {
      kind: 'unsupported',
      reason: 'version',
      version: value.version as number,
      features: [],
    }
  const requiredFeatures = features(value.requiredFeatures, limits)
  const unsupported = requiredFeatures.filter(
    (feature) => !supportedFeatures.has(feature),
  )
  if (unsupported.length)
    return {
      kind: 'unsupported',
      reason: 'features',
      version: 2,
      features: unsupported,
    }
  const name = normalizeName(value.name, limits)
  const document = value.document
  if (
    !record(document) ||
    document.path !== 'document.yjs' ||
    document.encoding !== 'yjs-update-v1' ||
    !isAssetId(document.sha256) ||
    !length(document.byteLength, limits.documentBytes)
  )
    return fail('Invalid document descriptor')
  if (!Array.isArray(value.assets) || value.assets.length + 2 > limits.entries)
    return fail('Invalid asset inventory')
  const assets: Manifest['assets'] = []
  const ids = new Set<string>()
  for (const asset of value.assets) {
    if (
      !record(asset) ||
      !isAssetId(asset.id) ||
      asset.path !== pathFor(asset.id) ||
      !length(asset.byteLength, limits.assetBytes) ||
      typeof asset.mediaType !== 'string' ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(asset.mediaType) ||
      asset.mediaType.length > 127 ||
      ids.has(asset.id)
    )
      return fail('Invalid or duplicate asset descriptor')
    ids.add(asset.id)
    assets.push({
      id: asset.id,
      path: asset.path,
      mediaType: asset.mediaType,
      byteLength: asset.byteLength,
    })
  }
  return {
    format: 'concept',
    version: 2,
    origin: 'Concept',
    name,
    document: {
      path: 'document.yjs',
      encoding: 'yjs-update-v1',
      sha256: document.sha256,
      byteLength: document.byteLength,
    },
    assets,
    requiredFeatures,
  }
}

interface ZipEntry {
  path: string
  method: number
  crc: number
  compressed: number
  expanded: number
  start: number
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  return value >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = -1
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ -1) >>> 0
}

function zipEntries(bytes: Uint8Array, limits: PackageLimits): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  let end = bytes.length - 22
  const minimum = Math.max(0, end - 65535)
  while (
    end >= minimum &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)
  )
    end--
  if (end < minimum) return fail('Truncated or invalid ZIP directory')
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    fail('Multi-disk ZIP packages are unsupported')
  const count = u16(end + 10)
  const centralSize = u32(end + 12)
  const centralStart = u32(end + 16)
  if (count > limits.entries || centralStart + centralSize !== end)
    fail('Invalid ZIP directory bounds')
  const result: ZipEntry[] = []
  const paths = new Set<string>()
  let cursor = centralStart
  let expandedTotal = 0
  let localEnd = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
      fail('Malformed ZIP directory entry')
    const flags = u16(cursor + 8)
    const method = u16(cursor + 10)
    const crc = u32(cursor + 16)
    const compressed = u32(cursor + 20)
    const expanded = u32(cursor + 24)
    const nameSize = u16(cursor + 28)
    const extraSize = u16(cursor + 30)
    const commentSize = u16(cursor + 32)
    const local = u32(cursor + 42)
    const next = cursor + 46 + nameSize + extraSize + commentSize
    if (
      next > end ||
      flags & ~0x080e ||
      (method !== 0 && method !== 8) ||
      u16(cursor + 34)
    )
      fail('Unsupported or encrypted ZIP entry')
    const path = decoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameSize),
    )
    if (
      !(
        path === 'manifest.json' ||
        path === 'document.yjs' ||
        /^assets\/[0-9a-f]{64}$/.test(path)
      ) ||
      paths.has(path)
    )
      fail('Unexpected or duplicate ZIP path')
    paths.add(path)
    const maximum =
      path === 'manifest.json'
        ? limits.manifestBytes
        : path === 'document.yjs'
          ? limits.documentBytes
          : limits.assetBytes
    expandedTotal += expanded
    if (
      expanded > maximum ||
      expandedTotal > limits.expandedBytes ||
      expanded > Math.max(1, compressed) * limits.expansionRatio
    )
      fail('ZIP expansion exceeds resource limits')
    if (
      local !== localEnd ||
      local + 30 > centralStart ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      fail('Invalid local ZIP header')
    const localNameSize = u16(local + 26)
    const start = local + 30 + localNameSize + u16(local + 28)
    if (
      start + compressed > centralStart ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !==
        path
    )
      fail('Conflicting ZIP entry names or bounds')
    if (
      !(flags & 8) &&
      (u32(local + 14) !== crc ||
        u32(local + 18) !== compressed ||
        u32(local + 22) !== expanded)
    )
      fail('Conflicting ZIP entry sizes')
    localEnd = start + compressed
    if (flags & 8) {
      if (localEnd + 12 > centralStart) fail('Missing ZIP data descriptor')
      if (u32(localEnd) === 0x08074b50) localEnd += 4
      if (
        localEnd + 12 > centralStart ||
        u32(localEnd) !== crc ||
        u32(localEnd + 4) !== compressed ||
        u32(localEnd + 8) !== expanded
      )
        fail('Invalid ZIP data descriptor')
      localEnd += 12
    }
    result.push({ path, method, crc, compressed, expanded, start })
    cursor = next
  }
  if (cursor !== end || localEnd !== centralStart) fail('Undeclared ZIP data')
  return result
}

function expandEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  signal?: AbortSignal,
): Uint8Array {
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed)
  let output: Uint8Array
  if (entry.method === 0) output = compressed.slice()
  else {
    const chunks: Uint8Array[] = []
    let size = 0
    const inflate = new Inflate((chunk) => {
      size += chunk.length
      if (size > entry.expanded)
        fail('ZIP entry exceeds its declared expanded size')
      chunks.push(chunk)
    })
    // Small compressed chunks bound allocations even when a hostile deflate
    // stream lies about its expanded length in the central directory.
    try {
      if (!compressed.length) inflate.push(compressed, true)
      for (let offset = 0; offset < compressed.length; offset += 256) {
        checkSignal(signal)
        inflate.push(
          compressed.subarray(offset, offset + 256),
          offset + 256 >= compressed.length,
        )
      }
    } catch (error) {
      if (signal?.aborted || error instanceof PackageValidationError)
        throw error
      fail('Invalid ZIP compression stream')
    }
    output = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
  }
  if (output.length !== entry.expanded || crc32(output) !== entry.crc)
    fail('ZIP entry size or CRC mismatch')
  return output
}

export async function readPackage(
  input: Blob | Uint8Array,
  options: PackageOptions = {},
): Promise<PackageReadResult> {
  const limits = { ...packageLimits, ...options.limits }
  checkSignal(options.signal)
  const binaryInput = ArrayBuffer.isView(input)
  const size = binaryInput ? input.byteLength : input.size
  if (size > limits.packageBytes) fail('Concept package exceeds the size limit')
  const bytes = binaryInput
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(await input.arrayBuffer())
  checkSignal(options.signal)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    let value: unknown
    try {
      value = JSON.parse(decoder.decode(bytes))
    } catch {
      return fail('Invalid Concept file')
    }
    if (
      !record(value) ||
      value.format !== 'concept' ||
      value.origin !== 'Concept' ||
      !Number.isSafeInteger(value.version)
    )
      return fail('Invalid Concept file')
    if (value.version !== 1)
      return {
        kind: 'unsupported',
        reason: 'version',
        version: value.version as number,
        features: [],
      }
    const name = normalizeName(value.name, limits)
    if (
      typeof value.update !== 'string' ||
      value.update.length > Math.ceil(limits.documentBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.update,
      )
    )
      return fail('Invalid legacy document update')
    const update = Uint8Array.from(atob(value.update), (character) =>
      character.charCodeAt(0),
    )
    validateUpdate(update, limits)
    const snapshot: NormalizedSnapshot = {
      name,
      update,
      assets: [],
      requiredFeatures: [],
    }
    try {
      const missingAssets = [...collectReferences(update)].sort()
      return missingAssets.length
        ? { kind: 'incomplete', snapshot, missingAssets }
        : { kind: 'complete', snapshot }
    } catch (error) {
      if (error instanceof UnsupportedNodeError)
        return {
          kind: 'unsupported',
          reason: 'features',
          version: 1,
          features: [`node:${error.nodeType}`],
        }
      throw error
    }
  }
  let entries: ZipEntry[]
  try {
    entries = zipEntries(bytes, limits)
  } catch (error) {
    if (error instanceof PackageValidationError) throw error
    return fail('Invalid ZIP structure')
  }
  const inventory = new Map(entries.map((entry) => [entry.path, entry]))
  const manifestEntry = inventory.get('manifest.json')
  if (!manifestEntry) return fail('Missing manifest')
  let value: unknown
  try {
    value = JSON.parse(
      decoder.decode(expandEntry(bytes, manifestEntry, options.signal)),
    )
  } catch (error) {
    if (error instanceof PackageValidationError) throw error
    return fail('Invalid manifest JSON')
  }
  const manifest = parseManifest(value, limits)
  if ('kind' in manifest) return manifest
  const documentEntry = inventory.get('document.yjs')
  if (!documentEntry) return fail('Missing document update')
  const update = expandEntry(bytes, documentEntry, options.signal)
  if (
    update.length !== manifest.document.byteLength ||
    (await assetId(update)) !== manifest.document.sha256
  )
    return fail('Document hash or size mismatch')
  validateUpdate(update, limits)
  const declared = new Set([
    'manifest.json',
    'document.yjs',
    ...manifest.assets.map((asset) => asset.path),
  ])
  for (const entry of entries)
    if (!declared.has(entry.path)) fail('Undeclared asset payload')
  const assets: PackageAsset[] = []
  const missing = new Set<AssetId>()
  for (const descriptor of manifest.assets) {
    checkSignal(options.signal)
    const entry = inventory.get(descriptor.path)
    if (!entry) {
      missing.add(descriptor.id)
      continue
    }
    const payload = expandEntry(bytes, entry, options.signal)
    if (
      payload.length !== descriptor.byteLength ||
      (await assetId(payload)) !== descriptor.id
    )
      return fail('Asset hash or size mismatch')
    const mediaType = normalizeAssetMediaType(payload)
    assets.push({
      descriptor: { id: descriptor.id, byteLength: payload.length, mediaType },
      blob: new Blob([new Uint8Array(payload)], { type: mediaType }),
    })
  }
  try {
    for (const id of collectReferences(update))
      if (!assets.some((asset) => asset.descriptor.id === id)) missing.add(id)
  } catch (error) {
    if (error instanceof UnsupportedNodeError)
      return {
        kind: 'unsupported',
        reason: 'features',
        version: 2,
        features: [`node:${error.nodeType}`],
      }
    throw error
  }
  checkSignal(options.signal)
  const snapshot = {
    name: manifest.name,
    update,
    assets,
    requiredFeatures: manifest.requiredFeatures,
  }
  return missing.size
    ? { kind: 'incomplete', snapshot, missingAssets: [...missing].sort() }
    : { kind: 'complete', snapshot }
}

export async function snapshotRevision(
  snapshot: Pick<NormalizedSnapshot, 'name' | 'update' | 'requiredFeatures'> & {
    assets: ReadonlyArray<{ descriptor: AssetDescriptor }>
  },
): Promise<string> {
  const name = snapshot.name.trim() || 'Untitled document'
  const update = snapshot.update.slice()
  const assets = snapshot.assets
    .map(({ descriptor }) => ({
      id: descriptor.id,
      mediaType: descriptor.mediaType,
      byteLength: descriptor.byteLength,
    }))
    .sort((a, b) => compareIds(a.id, b.id))
  const requiredFeatures = [...snapshot.requiredFeatures].sort()
  const canonical = JSON.stringify({
    format: 'concept',
    version: 2,
    encoding: 'yjs-update-v1',
    name,
    document: await assetId(update),
    assets,
    requiredFeatures,
  })
  return (await assetId(encoder.encode(canonical))).slice(7)
}

export async function writePackage(
  snapshot: NormalizedSnapshot,
  options: PackageOptions = {},
): Promise<Uint8Array> {
  const limits = { ...packageLimits, ...options.limits }
  checkSignal(options.signal)
  const name = normalizeName(snapshot.name, limits)
  const update = snapshot.update.slice()
  validateUpdate(update, limits)
  const requiredFeatures = features(snapshot.requiredFeatures, limits)
  if (requiredFeatures.some((feature) => !supportedFeatures.has(feature)))
    fail('Unsupported required package feature')
  if (snapshot.assets.length + 2 > limits.entries)
    fail('Too many package entries')
  const required = collectReferences(update)
  const assets = snapshot.assets
    .map(({ descriptor, blob }) => ({ descriptor: { ...descriptor }, blob }))
    .sort((a, b) => compareIds(a.descriptor.id, b.descriptor.id))
  const manifestAssets: Manifest['assets'] = []
  const payloads: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >
  payloads['document.yjs'] = update
  let expanded = update.length
  for (const { descriptor, blob } of assets) {
    checkSignal(options.signal)
    if (
      !isAssetId(descriptor.id) ||
      !length(descriptor.byteLength, limits.assetBytes) ||
      descriptor.byteLength !== blob.size ||
      manifestAssets.some((asset) => asset.id === descriptor.id)
    )
      fail('Invalid or duplicate package asset')
    expanded += blob.size
    if (expanded > limits.expandedBytes || expanded > limits.packageBytes)
      fail('Package exceeds expanded or stored size limit')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (
      (await assetId(bytes)) !== descriptor.id ||
      normalizeAssetMediaType(bytes) !== descriptor.mediaType
    )
      fail('Asset descriptor does not match its bytes')
    const path = pathFor(descriptor.id)
    manifestAssets.push({ ...descriptor, path })
    payloads[path] = bytes
  }
  const missing = [...required].filter(
    (id) => !manifestAssets.some((asset) => asset.id === id),
  )
  if (missing.length) throw new IncompleteAssetsError(missing)
  const manifest: Manifest = {
    format: 'concept',
    version: 2,
    origin: 'Concept',
    name,
    document: {
      path: 'document.yjs',
      encoding: 'yjs-update-v1',
      sha256: await assetId(update),
      byteLength: update.length,
    },
    assets: manifestAssets,
    requiredFeatures,
  }
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  if (
    manifestBytes.length > limits.manifestBytes ||
    expanded + manifestBytes.length > limits.expandedBytes
  )
    fail('Manifest exceeds resource limits')
  const storedBytes =
    expanded +
    manifestBytes.length +
    22 +
    ['manifest.json', ...Object.keys(payloads)].reduce(
      (total, path) => total + 76 + 2 * encoder.encode(path).length,
      0,
    )
  if (storedBytes > limits.packageBytes)
    fail('Concept package exceeds the size limit')
  checkSignal(options.signal)
  // Stored entries keep already-compressed assets intact and bound writer CPU.
  const output = zipSync(
    { 'manifest.json': manifestBytes, ...payloads },
    { level: 0 },
  )
  if (output.length > limits.packageBytes)
    fail('Concept package exceeds the size limit')
  return output
}
