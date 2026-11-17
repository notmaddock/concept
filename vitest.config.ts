import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { changelogPlugin } from './scripts/changelog-plugin.ts'

const nodeTestPatterns = [
  'scripts/*.test.ts',
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

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [changelogPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
    testTimeout: 15_000,
    reporters: process.env.GITHUB_ACTIONS
      ? ['default', 'github-actions']
      : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/routeTree.gen.ts',
        'src/components/ui/**',
        'src/test/**',
      ],
    },
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
