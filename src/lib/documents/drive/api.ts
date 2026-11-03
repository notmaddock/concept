import {
  getGoogleDriveToken,
  GoogleDriveAuthError,
  invalidateGoogleDriveToken,
} from './auth'

const api = 'https://www.googleapis.com/drive/v3/files'
// v2 exposes the file ETag in JSON for conditional uploads.
const conditionalApi = 'https://www.googleapis.com/drive/v2/files'
const uploadApi = 'https://www.googleapis.com/upload/drive/v2/files'
const mimeType = 'application/vnd.concept+json'
const fields = 'id,name,mimeType,modifiedTime,size,version,headRevisionId'
const conditionalFields =
  'id,title,mimeType,modifiedDate,fileSize,version,headRevisionId,etag'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
  version?: string
  headRevisionId?: string
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
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  retryAuth = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getGoogleDriveToken()
  headers.set('Authorization', `Bearer ${token}`)
  const timeout = AbortSignal.timeout(30000)
  const response = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  })
  if (response.status === 401) {
    let currentToken: string | undefined
    try {
      currentToken = getGoogleDriveToken()
    } catch {}
    if (retryAuth && currentToken && currentToken !== token)
      return request(url, init, false)
    invalidateGoogleDriveToken(token)
    throw new GoogleDriveAuthError()
  }
  if (!response.ok)
    throw new DriveError(
      response.status,
      response.status === 412
        ? 'Google Drive has newer changes.'
        : `Google Drive request failed (${response.status}).`,
    )
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
    q: `trashed = false and (mimeType = '${mimeType}' or name contains '.concept')`,
    fields: `files(${fields})`,
    pageSize: '100',
    orderBy: 'modifiedTime desc',
  })
  const response = await request(`${api}?${parameters}`)
  const result = (await response.json()) as { files: Array<DriveFile> }
  return result.files.filter(
    (file) =>
      file.mimeType === mimeType ||
      file.name.toLowerCase().endsWith('.concept'),
  )
}

export async function listFolders(
  parentId = 'root',
): Promise<Array<DriveFile>> {
  const parameters = new URLSearchParams({
    q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and '${parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents`,
    fields: `nextPageToken,files(${fields})`,
    pageSize: '100',
    orderBy: 'name',
  })
  const files: Array<DriveFile> = []
  let pageToken: string | undefined
  do {
    if (pageToken) parameters.set('pageToken', pageToken)
    const response = await request(`${api}?${parameters}`)
    const result = (await response.json()) as {
      files: Array<DriveFile>
      nextPageToken?: string
    }
    files.push(...result.files)
    pageToken = result.nextPageToken
  } while (pageToken)
  return files
}

export async function readConceptFile(
  id: string,
  signal?: AbortSignal,
): Promise<DriveFileVersion & { content: string }> {
  // Bind downloaded bytes to their validator even if another writer saves mid-read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await getFileMetadata(id, signal)
    const etag = requiredEtag(before.etag)
    const response = await request(
      `${api}/${encodeURIComponent(id)}?alt=media`,
      { signal },
    )
    const content = await response.text()
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
  content: string,
  etag?: string,
  parentId = 'root',
  filename?: string,
  signal?: AbortSignal,
): Promise<DriveFileVersion> {
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
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n`,
    content,
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
  content: string,
  parentId = 'root',
) {
  return upload('POST', undefined, name, content, undefined, parentId)
}

export function updateConceptFile(
  id: string,
  name: string,
  content: string,
  etag: string,
  filename?: string,
  signal?: AbortSignal,
) {
  return upload('PUT', id, name, content, etag, 'root', filename, signal)
}

export async function trashConceptFile(id: string): Promise<void> {
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
