import { env } from 'cloudflare:workers'
import { applyUpdate, Doc } from 'yjs'
import { getAuth, getProviderAccessToken } from '#/lib/auth/server'
import { googlePermissions } from '#/lib/auth/connections'
import { parseConcept, serializeConcept } from '../concept-file'
import type { DocumentInfo } from '../storage'
import type { SaveDriveInput } from './functions'

const api = 'https://www.googleapis.com/drive/v3/files'
const upload = 'https://www.googleapis.com/upload/drive/v3/files'
const mimeType = 'application/vnd.concept+json'
const fields = 'id,name,modifiedTime,appProperties,trashed,version'
interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  appProperties?: { conceptId?: string }
  trashed?: boolean
  version?: string
}

async function connection(headers: Headers, accountId?: string) {
  if (!accountId) {
    const auth = getAuth()
    if (!(await auth.api.getSession({ headers })))
      throw new Error('Sign in and connect Google Drive in account settings.')
    const accounts = await auth.api.listUserAccounts({ headers })
    accountId = accounts.find(
      (account) =>
        account.providerId === 'google' &&
        'driveConnected' in account &&
        account.driveConnected === true,
    )?.id
  }
  if (!accountId)
    throw new Error('Connect Google Drive in account settings first.')
  const { accessToken } = await getProviderAccessToken(
    headers,
    accountId,
    googlePermissions[0].scopes,
  )
  return { accountId, accessToken }
}

async function request(token: string, url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })
  if (response.status === 412)
    throw new Error(
      'The Drive document changed during saving. Retry to merge the latest changes.',
    )
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'Google Drive access was denied. Reconnect in account settings.',
    )
  if (response.status === 404)
    throw new Error('The Google Drive file is missing or no longer accessible.')
  if (!response.ok)
    throw new Error(
      'Google Drive is unavailable. Your browser copy is safe; try again.',
    )
  return response
}

function info(file: DriveFile, accountId: string): DocumentInfo {
  const id = file.appProperties?.conceptId
  if (!id || file.trashed)
    throw new Error('This is not an available Concept document.')
  return {
    id,
    name: file.name.replace(/\.concept$/i, ''),
    updatedAt: Date.parse(file.modifiedTime),
    backing: {
      provider: 'google-drive',
      fileId: file.id,
      accountId,
      syncedName: file.name.replace(/\.concept$/i, ''),
    },
  }
}

export async function listDriveDocuments(headers: Headers) {
  const { accountId, accessToken } = await connection(headers)
  const documents: Array<DocumentInfo> = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `trashed = false and mimeType = '${mimeType}'`,
      fields: `nextPageToken,files(${fields})`,
      pageSize: '100',
      ...(pageToken ? { pageToken } : {}),
    })
    const response = await request(accessToken, `${api}?${params}`)
    const page = await response.json<{
      files: Array<DriveFile>
      nextPageToken?: string
    }>()
    documents.push(
      ...page.files
        .filter((file) => file.appProperties?.conceptId)
        .map((file) => info(file, accountId)),
    )
    pageToken = page.nextPageToken
  } while (pageToken)
  return documents.sort((a, b) => b.updatedAt - a.updatedAt)
}

async function read(token: string, accountId: string, fileId: string) {
  const url = `${api}/${encodeURIComponent(fileId)}`
  const metadata = await request(token, `${url}?fields=${fields}`)
  const file = await metadata.json<DriveFile>()
  const document = info(file, accountId)
  const etag = metadata.headers.get('etag')
  // Drive v3 responses need not include an ETag. Use it when supplied, and
  // otherwise check the documented version after downloading the content.
  const content = await request(token, `${url}?alt=media`, {
    headers: etag ? { 'If-Match': etag } : {},
  })
  const parsed = parseConcept(await content.text())
  if (!etag && file.version) {
    const latest = await request(token, `${url}?fields=version`)
    if ((await latest.json<DriveFile>()).version !== file.version)
      throw new Error(
        'The Drive document changed during saving. Retry to merge the latest changes.',
      )
  }
  return { document, file: parsed, etag: etag ?? undefined }
}

export async function readDriveDocument(
  headers: Headers,
  accountId: string,
  fileId: string,
) {
  const { accessToken } = await connection(headers, accountId)
  const { document, file } = await read(accessToken, accountId, fileId)
  return { document, file }
}

export async function saveDriveDocument(
  headers: Headers,
  data: SaveDriveInput,
) {
  const { accountId, accessToken } = await connection(headers, data.accountId)
  if (data.fileId) {
    // File identity (not user or account identity) coordinates different devices
    // and different accounts that can access the same backing file.
    // HTTP bodies keep large snapshots outside Workers RPC's 32 MiB value cap.
    const response = await env.DRIVE_SAVES.getByName(data.fileId).fetch(
      new Request('https://drive-save.internal/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ accountId, data }),
      }),
    )
    if (!response.ok) {
      const failure = await response.json<{ error: string }>()
      throw new Error(failure.error)
    }
    return response.json<{
      document: DocumentInfo
      file: ReturnType<typeof parseConcept>
    }>()
  }
  return saveDriveFile(accessToken, accountId, data)
}

// Called only after authorization, either here for creation or by the per-file
// Durable Object for the entire read/merge/write sequence of existing files.
export async function saveDriveFile(
  accessToken: string,
  accountId: string,
  data: SaveDriveInput,
) {
  const file = parseConcept(data.text)
  let text = JSON.stringify({ ...file, name: data.name })
  let etag: string | undefined
  if (data.fileId) {
    const remote = await read(accessToken, accountId, data.fileId)
    if (remote.document.id !== data.id)
      throw new Error(
        'The backing file belongs to a different Concept document.',
      )
    etag = remote.etag
    if (data.previousName === data.name) data.name = remote.document.name
    const doc = new Doc()
    try {
      for (const update of [remote.file.update, file.update])
        applyUpdate(
          doc,
          Uint8Array.from(atob(update), (character) => character.charCodeAt(0)),
        )
      text = serializeConcept(data.name, doc)
    } finally {
      doc.destroy()
    }
  }
  const boundary = `concept_${crypto.randomUUID()}`
  const metadata = {
    name: `${data.name}.concept`,
    mimeType,
    appProperties: { conceptId: data.id },
  }
  const response = await request(
    accessToken,
    `${upload}${data.fileId ? `/${encodeURIComponent(data.fileId)}` : ''}?uploadType=multipart&fields=${fields}`,
    {
      method: data.fileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        ...(etag ? { 'If-Match': etag } : {}),
      },
      body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${text}\r\n--${boundary}--`,
    },
  )
  return {
    document: info(await response.json<DriveFile>(), accountId),
    file: parseConcept(text),
  }
}
