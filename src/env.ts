import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  clientPrefix: 'VITE_',

  client: {
    VITE_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    VITE_GOOGLE_PICKER_API_KEY: z.string().min(1).optional(),
    VITE_GOOGLE_PICKER_APP_ID: z.string().min(1).optional(),
  },

  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
})
