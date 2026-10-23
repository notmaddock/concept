// @vitest-environment node
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { ConceptFile } from '../concept-file'
import { convertImport } from '../import'
import { readDrive, saveDrive, saveDriveRequest } from './functions'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
  inputs: [] as Array<unknown>,
  responses: [] as Array<Response>,
}))
vi.mock('./server', () => ({
  saveDriveDocument: mocks.save,
  readDriveDocument: mocks.read,
  listDriveDocuments: mocks.list,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))
// Exercise the native HTTP body/response boundaries around the handlers. The
// actual framework's FormData and raw Response branches bypass Seroval.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      validator(
        next:
          ((data: unknown) => unknown) | { parse: (data: unknown) => unknown },
      ) {
        validate =
          typeof next === 'function' ? next : (data) => next.parse(data)
        return builder
      },
      handler(handler: (options: { data: unknown }) => Promise<Response>) {
        return async ({ data }: { data: unknown }) => {
          mocks.inputs.push(data)
          if (data instanceof FormData) {
            const request = new Request('https://concept.test/_serverFn/save', {
              method: 'POST',
              body: data,
            })
            expect(request.headers.get('Content-Type')).toContain(
              'multipart/form-data',
            )
            data = await request.formData()
          }
          const response = await handler({ data: validate(data) })
          mocks.responses.push(response.clone())
          return response
        }
      },
    }
    return builder
  },
}))

let file: ConceptFile
const document = {
  id: '0aad2d15-507a-43ca-8a04-e194484002a3',
  name: 'Long document',
  updatedAt: 1,
}
beforeAll(async () => {
  // A genuine long Lexical/Yjs document: over 10 MB after encoding, with Unicode
  // and quotes. Request parsing must not depend on Seroval's escaped-string regex.
  const paragraph = 'A long paragraph — café 🌎 "quoted" \\ words. '.repeat(
    200_000,
  )
  file = await convertImport(new File([paragraph], 'Long.txt'), 'text')
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.inputs.length = 0
  mocks.responses.length = 0
  mocks.save.mockResolvedValue({ document, file })
  mocks.read.mockResolvedValue({ document, file })
})
it('round trips a multi-megabyte document using multipart upload and raw JSON response', async () => {
  const text = JSON.stringify(file)
  expect(text.length).toBeGreaterThan(10 * 1024 * 1024)
  const data = {
    id: document.id,
    name: 'Long "document" 🌎',
    text,
    accountId: 'account',
    fileId: 'drive-file',
    previousName: 'Long document',
  }
  const result = await saveDrive({ data })
  expect(mocks.inputs[0]).toBeInstanceOf(FormData)
  expect(mocks.save).toHaveBeenCalledWith(expect.any(Headers), data)
  expect(mocks.responses[0]).toBeInstanceOf(Response)
  expect(mocks.responses[0].headers.get('Cache-Control')).toBe('no-store')
  expect(result).toEqual({ document, file })
})
it('downloads long documents as a raw response rather than a serialized RPC object', async () => {
  expect(
    await readDrive({ data: { accountId: 'account', fileId: 'drive-file' } }),
  ).toEqual({ document, file })
  expect(mocks.read).toHaveBeenCalledWith(
    expect.any(Headers),
    'account',
    'drive-file',
  )
  expect(mocks.responses[0].headers.get('Content-Type')).toContain(
    'application/json',
  )
  expect(mocks.responses[0].headers.get('Cache-Control')).toBe('no-store')
})
it('keeps upload validation before the storage adapter', async () => {
  await expect(saveDriveRequest({ data: {} as FormData })).rejects.toThrow(
    'Expected a document upload',
  )
  await expect(
    saveDrive({
      data: { id: document.id, name: 'Long', text: '{}', fileId: 'drive-file' },
    }),
  ).rejects.toThrow('The document upload is invalid')
  expect(mocks.save).not.toHaveBeenCalled()
})
it('preserves authorization failures so the session can keep its recovery copy and retry', async () => {
  mocks.save.mockRejectedValue(
    new Error('Sign in to use a storage connection.'),
  )
  await expect(
    saveDrive({
      data: { id: document.id, name: 'Long', text: JSON.stringify(file) },
    }),
  ).rejects.toThrow('Sign in')
})
