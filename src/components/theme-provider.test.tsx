import { expect, it } from 'vitest'
import { getThemeScript } from './theme-provider'

it('keeps script-closing markup and line separators inside the theme storage key', () => {
  const key = '</script><script>alert("injected")</script>\u2028\u2029'
  const script = getThemeScript(key, 'system')
  expect(script).not.toContain('<')
  expect(script).not.toContain('\u2028')
  expect(script).not.toContain('\u2029')
  const page = new DOMParser().parseFromString(
    `<script>${script}</script>`,
    'text/html',
  )
  expect(page.querySelectorAll('script')).toHaveLength(1)
  const encoded = script.match(/getItem\((.*?)\);/)![1]
  expect(JSON.parse(encoded)).toBe(key)
})
