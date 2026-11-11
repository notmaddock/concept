import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { cloudflare } from '@cloudflare/vite-plugin'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

const config = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: { tsconfigPaths: true },
  build: {
    rolldownOptions: {
      // Timing diagnostics depend on machine load; opt in when profiling builds.
      checks: { bundlerTimings: process.env.PROFILE_BUILD === '1' },
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    svgr(),
    cloudflare({
      viteEnvironment: {
        name: 'ssr',
      },
    }),
  ],
})

export default config
