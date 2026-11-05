import { packageLimits } from '../limits'
import {
  getGoogleDriveToken,
  GoogleDriveAuthError,
  invalidateGoogleDriveSession,
} from './auth'

const api = 'https://www.googleapis.com/drive/v3/files'
// v2 exposes the file ETag in JSON for conditional uploads.
const conditionalApi = 'https://www.googleapis.com/drive/v2/files'
const uploadApi = 'https://www.googleapis.com/upload/drive/v2/files'
export const conceptMimeType = 'application/vnd.concept+zip'
export const legacyConceptMimeType = 'application/vnd.concept+json'
const mimeType = conceptMimeType
const fields =
  'id,name,mimeType,modifiedTime,size,version,headRevisionId,capabilities(canEdit,canModifyContent,canComment,canCopy)'
const conditionalFields =
  'id,title,mimeType,modifiedDate,fileSize,version,headRevisionId,etag,capabilities(canEdit,canModifyContent,canComment,canCopy)'

export interface DriveCapabilities {
  canEdit?: boolean
  canComment?: boolean
  canCopy?: boolean
  canModifyContent?: boolean
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
  version?: string
  headRevisionId?: string
  capabilities?: DriveCapabilities
}

export function isDriveFileReadOnly(file: DriveFile): boolean {
  if (!file.capabilities) return false
  return (
    file.capabilities.canEdit === false ||
    file.capabilities.canModifyContent === false
  )
}

export interface DriveFileVersion {
  file: DriveFile
  etag: string
}

export class DriveError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveError'
  }
}

export class DriveCreatedFileError extends DriveError {
  constructor(public readonly file: DriveFile) {
    super(
      0,
      'File created on Google Drive, but no ETag was returned. Open the saved file before retrying.',
    )
    this.name = 'DriveCreatedFileError'
  }
}

interface ConditionalFile extends Omit<
  DriveFile,
  'name' | 'modifiedTime' | 'size'
> {
  title: string
  modifiedDate?: string
  fileSize?: string
  etag?: string
  capabilities?: DriveCapabilities
}

function normalizeFile(file: ConditionalFile): DriveFile {
  return {
    id: file.id,
    name: file.title,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedDate,
    size: file.fileSize,
    version: file.version,
    headRevisionId: file.headRevisionId,
    capabilities: file.capabilities,
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  retryAuth = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = await getGoogleDriveToken({ signal: init.signal ?? undefined })
  init.signal?.throwIfAborted()
  headers.set('Authorization', `Bearer ${token}`)
  const timeout = AbortSignal.timeout(30000)
  const requestUrl = new URL(url)
  requestUrl.searchParams.set('supportsAllDrives', 'true')
  const response = await fetch(requestUrl.toString(), {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'omit',
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  })
  if (response.status === 401) {
    if (retryAuth) {
      await response.body?.cancel()
      const current = await getGoogleDriveToken({
        signal: init.signal ?? undefined,
      })
      if (current === token)
        await getGoogleDriveToken({
          forceRefresh: true,
          signal: init.signal ?? undefined,
        })
      return request(url, init, false)
    }
    invalidateGoogleDriveSession()
    throw new GoogleDriveAuthError()
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new DriveError(
      response.status,
      response.status === 412
        ? 'Google Drive has newer changes.'
        : `Google Drive request failed (${response.status}).`,
    )
  }
  return response
}

function requiredEtag(value: string | null | undefined): string {
  if (!value || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value))
    throw new DriveError(
      0,
      'Google Drive did not provide a strong ETag. Safe syncing is unavailable.',
    )
  return value
}

function fileUrl(id: string) {
  return `${conditionalApi}/${encodeURIComponent(id)}`
}

export async function getFileMetadata(id: string, signal?: AbortSignal) {
  if (!id.trim()) throw new DriveError(400, 'Invalid file ID.')
  const response = await request(`${fileUrl(id)}?fields=${conditionalFields}`, {
    signal,
  })
  const file = (await response.json()) as ConditionalFile
  return {
    file: normalizeFile(file),
    etag: requiredEtag(file.etag),
  }
}

export async function listConceptFiles(): Promise<Array<DriveFile>> {
  const parameters = new URLSearchParams({
    q: `trashed = false and (mimeType = '${mimeType}' or mimeType = '${legacyConceptMimeType}' or name contains '.concept')`,
    fields: `nextPageToken,files(${fields})`,
    pageSize: '100',
    includeItemsFromAllDrives: 'true',
    orderBy: 'modifiedTime desc',
  })
  const files: Array<DriveFile> = []
  let pageToken: string | undefined
  do {
    if (pageToken) parameters.set('pageToken', pageToken)
    const response = await request(`${api}?${parameters}`)
    const result = (await response.json()) as {
      files?: Array<DriveFile>
      nextPageToken?: string
    }
    files.push(
      ...(result.files ?? []).filter(
        (file) =>
          file.mimeType === mimeType ||
          file.mimeType === legacyConceptMimeType ||
          file.name.toLowerCase().endsWith('.concept'),
      ),
    )
    pageToken = result.nextPageToken
  } while (pageToken)
  return files
}

export async function listFolders(
  parentId = 'root',
): Promise<Array<DriveFile>> {
  const parameters = new URLSearchParams({
    q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and '${parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents`,
    fields: `nextPageToken,files(${fields})`,
    pageSize: '100',
    includeItemsFromAllDrives: 'true',
    orderBy: 'name',
  })
  const files: Array<DriveFile> = []
  let pageToken: string | undefined
  do {
    if (pageToken) parameters.set('pageToken', pageToken)
    const response = await request(`${api}?${parameters}`)
    const result = (await response.json()) as {
      files?: Array<DriveFile>
      nextPageToken?: string
    }
    files.push(...(result.files ?? []))
    pageToken = result.nextPageToken
  } while (pageToken)
  return files
}

async function readMedia(response: Response, signal?: AbortSignal) {
  const limit = packageLimits.packageBytes
  const claimedLength = response.headers.get('Content-Length')
  if (claimedLength !== null && Number(claimedLength) > limit) {
    await response.body?.cancel()
    throw new DriveError(
      413,
      'Concept package exceeds the configured size limit.',
    )
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Array<Uint8Array> = []
  let byteLength = 0
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    for (;;) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > limit)
        throw new DriveError(
          413,
          'Concept package exceeds the configured size limit.',
        )
      chunks.push(value)
    }
    const content = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      content.set(chunk, offset)
      offset += chunk.byteLength
    }
    return content
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

export async function readConceptFile(
  id: string,
  signal?: AbortSignal,
  initial?: DriveFileVersion,
): Promise<DriveFileVersion & { content: Uint8Array }> {
  if (!id.trim()) throw new DriveError(400, 'Invalid file ID.')
  // Bind downloaded bytes to their validator even if another writer saves mid-read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before =
      attempt === 0 && initial ? initial : await getFileMetadata(id, signal)
    const etag = requiredEtag(before.etag)
    const response = await request(
      `${api}/${encodeURIComponent(id)}?alt=media`,
      { signal },
    )
    const content = await readMedia(response, signal)
    const after = await getFileMetadata(id, signal)
    if (etag === requiredEtag(after.etag))
      return { file: after.file, etag, content }
  }
  throw new DriveError(409, 'Google Drive keeps changing. Try again.')
}

async function upload(
  method: 'POST' | 'PUT',
  id: string | undefined,
  name: string,
  content: Uint8Array,
  etag?: string,
  parentId = 'root',
  filename?: string,
  signal?: AbortSignal,
): Promise<DriveFileVersion> {
  const media = new Blob([new Uint8Array(content)])
  if (media.size > packageLimits.packageBytes)
    throw new DriveError(
      413,
      'Concept package exceeds the configured size limit.',
    )
  const headers = new Headers()
  if (method === 'PUT') headers.set('If-Match', requiredEtag(etag))
  const boundary = `concept_${crypto.randomUUID()}`
  headers.set('Content-Type', `multipart/related; boundary=${boundary}`)
  const metadata = {
    title:
      filename ??
      (name.toLowerCase().endsWith('.concept') ? name : `${name}.concept`),
    mimeType,
    ...(method === 'POST' ? { parents: [{ id: parentId }] } : {}),
  }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    media,
    `\r\n--${boundary}--\r\n`,
  ])
  const response = await request(
    `${uploadApi}${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart&fields=${conditionalFields}`,
    { method, headers, body, signal },
  )
  const result = (await response.json()) as ConditionalFile
  const file = normalizeFile(result)
  try {
    return { file, etag: requiredEtag(result.etag) }
  } catch (error) {
    if (method === 'POST') throw new DriveCreatedFileError(file)
    throw error
  }
}

export function createConceptFile(
  name: string,
  content: Uint8Array,
  parentId = 'root',
) {
  return upload('POST', undefined, name, content, undefined, parentId)
}

export function updateConceptFile(
  id: string,
  name: string,
  content: Uint8Array,
  etag: string,
  filename?: string,
  signal?: AbortSignal,
) {
  return upload('PUT', id, name, content, etag, 'root', filename, signal)
}

export async function trashConceptFile(id: string): Promise<void> {
  if (!id.trim()) throw new DriveError(400, 'Invalid file ID.')
  const current = await getFileMetadata(id)
  await request(`${fileUrl(id)}?fields=id`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': requiredEtag(current.etag),
    },
    body: JSON.stringify({ labels: { trashed: true } }),
  })
}
