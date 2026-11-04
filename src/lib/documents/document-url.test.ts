import { expect, it } from 'vitest'
import { documentHash, documentIdFromHash } from './document-url'

it.each([
  [
    'e7dd1697-91f8-4f9b-a97a-7dd55d1735a5',
    'Le7dd1697-91f8-4f9b-a97a-7dd55d1735a5',
  ],
  ['G1Abc_def-456', 'G1Abc_def-456'],
])(
  'round trips the document identity %s through its provider hash',
  (id, hash) => {
    expect(documentHash(id)).toBe(hash)
    expect(documentIdFromHash(hash)).toBe(id)
  },
)

it.each([
  '',
  'G',
  'L',
  'unknown',
  'Uhttps://example.com/file',
  'G../etc/passwd',
  'Gfile/id?alt=media',
  'Ldoc:id',
  'G id with spaces',
])('ignores unsupported or malformed document hashes: %s', (hash) =>
  expect(documentIdFromHash(hash)).toBeUndefined(),
)
