import { DurableObject } from 'cloudflare:workers'
import { saveDriveFile } from './server'
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
        const accessToken = request.headers.get('Authorization')?.slice(7)
        if (!accessToken) throw new Error('Missing Drive authorization.')
        return Response.json(await saveDriveFile(accessToken, accountId, data))
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'Drive save failed.',
          },
          { status: 500 },
        )
      }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
