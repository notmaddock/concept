import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'

export const disconnectStorage = createServerFn({ method: 'POST' })
  .validator(z.object({ accountId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { disconnectStorageCredentials } = await import('./server')
    await disconnectStorageCredentials(getRequestHeaders(), data.accountId)
  })
