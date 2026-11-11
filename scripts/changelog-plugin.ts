import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { parseChangelog } from './changelog-parser.ts'

const VIRTUAL_ID = 'virtual:changelog'
const RESOLVED_ID = '\0' + VIRTUAL_ID

export function changelogPlugin(): Plugin {
  const changelogPath = fileURLToPath(
    new URL('../CHANGELOG.md', import.meta.url),
  )

  return {
    name: 'concept-changelog',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      const markdown = existsSync(changelogPath)
        ? readFileSync(changelogPath, 'utf8')
        : ''
      return `export default ${JSON.stringify(parseChangelog(markdown))}`
    },
  }
}
