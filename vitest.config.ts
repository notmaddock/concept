import { defineConfig } from 'vitest/config'
import path from 'node:path'

const nodeTestPatterns = [
  'src/**/*.server.test.ts',
  'src/lib/documents/drive/api.test.ts',
  'src/lib/documents/drive/create.test.ts',
  'src/lib/documents/drive/launch.test.ts',
  'src/lib/documents/document-theme.test.ts',
  'src/lib/documents/document-url.test.ts',
  'src/lib/documents/library-channel.test.ts',
  'src/lib/documents/local-provider.test.ts',
  'src/lib/documents/page-setup.test.ts',
  'src/lib/documents/realtime/*.test.ts',
  'src/worker/*.test.ts',
  'src/components/documents/filter-document-action.test.ts',
  'src/components/nova/plugins/FormatToolbarPlugin/color-contrast.test.ts',
]

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '#': path.resolve(import.meta.dirname, './src'),
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './src/test/cloudflare-workers.ts',
      ),
    },
  },
  test: {
    reporters: process.env.GITHUB_ACTIONS
      ? ['default', 'github-actions']
      : ['default'],
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          // Let browser storage dependencies use their in-memory Node fallback.
          execArgv: ['--no-experimental-webstorage'],
          include: nodeTestPatterns,
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: nodeTestPatterns,
        },
      },
    ],
  },
})
