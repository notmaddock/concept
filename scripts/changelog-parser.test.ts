import { describe, expect, it } from 'vitest'
import { parseChangelog } from './changelog-parser'

const markdown = `# Changelog

## [0.2.0](https://example.com/compare/v0.1.0...v0.2.0) (2026-11-10)

### Features

* **editor:** add **pagination** and \`page breaks\` ([abc1234](https://example.com/commit/abc1234))
* **changelog:** add release notes

### Bug Fixes

* **editor:** reflow pages after fonts load
`

describe('parseChangelog', () => {
  it('parses versions, sections, and inline formatting', () => {
    const [entry] = parseChangelog(markdown)

    expect(entry).toMatchObject({ version: '0.2.0', date: '2026-11-10' })
    expect(entry.sections.map((section) => section.title)).toEqual([
      'Features',
      'Bug Fixes',
    ])
    expect(entry.sections[0].items).toHaveLength(2)

    const [firstItem] = entry.sections[0].items
    expect(firstItem).toContainEqual({
      type: 'strong',
      children: [{ type: 'text', value: 'editor:' }],
    })
    expect(
      firstItem.some(
        (node) => node.type === 'code' && node.value === 'page breaks',
      ),
    ).toBe(true)
    expect(
      firstItem.some(
        (node) =>
          node.type === 'link' &&
          node.href === 'https://example.com/commit/abc1234',
      ),
    ).toBe(true)
  })

  it('returns no entries for empty input', () => {
    expect(parseChangelog('')).toEqual([])
  })
})
