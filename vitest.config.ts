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
    // VM pools break globals required by TanStack Start and workerd dependencies.
    pool: 'forks',
    // Suites depend on per-file module and global isolation.
    isolate: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
})
