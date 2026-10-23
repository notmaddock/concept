import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './src/test/cloudflare-workers.ts',
      ),
      '@': path.resolve(import.meta.dirname, './src'),
      '#': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
