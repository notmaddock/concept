import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHANGELOG_SEEN_KEY,
  getSeenChangelogVersion,
  markChangelogSeen,
} from './changelog'

describe('changelog storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores and reads the seen version', () => {
    expect(getSeenChangelogVersion()).toBeNull()

    markChangelogSeen('0.2.0')

    expect(getSeenChangelogVersion()).toBe('0.2.0')
    expect(localStorage.getItem(CHANGELOG_SEEN_KEY)).toBe('0.2.0')
  })
})
