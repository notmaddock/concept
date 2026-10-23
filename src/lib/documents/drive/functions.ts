import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { ConceptFile } from '../concept-file'
import type { DocumentInfo } from '../storage'

export interface DriveDocumentResult {
  document: DocumentInfo
  file: ConceptFile
}

export interface SaveDriveInput {
  id: string
  name: string
  text: string
  previousName?: string
  accountId?: string
  fileId?: string
}

export const listDrive = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { listDriveDocuments } = await import('./server')
    return listDriveDocuments(getRequestHeaders())
  },
)

// Keep document-sized payloads outside Seroval in both directions. Large escaped
// JSON strings can overflow its string decoder before the handler is reached.
export const readDriveRequest = createServerFn({ method: 'POST' })
  .validator(
    z.object({ accountId: z.string().min(1), fileId: z.string().min(1) }),
  )
  .handler(async ({ data }) => {
    const { readDriveDocument } = await import('./server')
    const result = await readDriveDocument(
      getRequestHeaders(),
      data.accountId,
      data.fileId,
    )
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  })

export const saveDriveRequest = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData))
      throw new Error('Expected a document upload.')
    const result = z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(1000),
        text: z.string().min(1),
        previousName: z.string().optional(),
        accountId: z.string().min(1).optional(),
        fileId: z.string().min(1).optional(),
      })
      .refine((input) => !input.fileId || Boolean(input.accountId))
      .safeParse(Object.fromEntries(data))
    if (!result.success)
      throw new Error(
        'The document upload is invalid. Choose a document and Google Drive connection, then try again.',
      )
    return result.data
  })
  .handler(async ({ data }) => {
    const { saveDriveDocument } = await import('./server')
    const result = await saveDriveDocument(getRequestHeaders(), data)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  })

export async function readDrive({
  data,
}: {
  data: { accountId: string; fileId: string }
}): Promise<DriveDocumentResult> {
  const response = await readDriveRequest({ data })
  return response.json<DriveDocumentResult>()
}

export async function saveDrive({
  data,
}: {
  data: SaveDriveInput
}): Promise<DriveDocumentResult> {
  const form = new FormData()
  for (const key of [
    'id',
    'name',
    'text',
    'previousName',
    'accountId',
    'fileId',
  ] as const) {
    const value = data[key]
    if (value !== undefined) form.set(key, value)
  }
  const response = await saveDriveRequest({ data: form })
  return response.json<DriveDocumentResult>()
}
