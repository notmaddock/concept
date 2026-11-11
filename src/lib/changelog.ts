export type ChangelogInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: ChangelogInline[] }
  | { type: 'emphasis'; children: ChangelogInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: ChangelogInline[] }

export type ChangelogEntry = {
  version: string
  date: string
  sections: { title: string; items: ChangelogInline[][] }[]
}

export const CHANGELOG_SEEN_KEY = 'concept:changelog-seen-version'

export function getSeenChangelogVersion(): string | null {
  try {
    return localStorage.getItem(CHANGELOG_SEEN_KEY)
  } catch {
    return null
  }
}

export function markChangelogSeen(version: string): void {
  try {
    localStorage.setItem(CHANGELOG_SEEN_KEY, version)
  } catch {
    // Storage unavailable
  }
}
