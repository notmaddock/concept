import { DurableObject } from 'cloudflare:workers'
import { DriveError, saveDriveFile } from './server'
import type { SaveDriveInput } from './functions'

// Cloudflare routes every request for a backing file to one object globally.
// The promise queue also prevents interleaving while Drive fetches yield. No
// credentials or document content are stored in Durable Object storage.
export class DriveSaveCoordinator extends DurableObject {
  private pending: Promise<unknown> = Promise.resolve()

  async fetch(request: Request) {
    const operation = this.pending.then(async () => {
      try {
        const { accountId, data } = await request.json<{
          accountId: string
          data: SaveDriveInput
        }>()
        const authHeader = request.headers.get('Authorization')
        const accessToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
        if (!accessToken)
          throw new DriveError('Missing Drive authorization.', 401)
        return Response.json(await saveDriveFile(accessToken, accountId, data))
      } catch (error) {
        const status = error instanceof DriveError ? error.status : 500
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'Drive save failed.',
          },
          { status },
        )
      }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
