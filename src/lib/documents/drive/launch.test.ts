import { expect, it } from 'vitest'
import { parseDriveLaunch } from './launch'

function state(value: unknown, encode = 1): string {
  let raw = JSON.stringify(value)
  for (let index = 0; index < encode; index++) raw = encodeURIComponent(raw)
  return `?state=${raw}`
}

it('parses an Open URL state', () => {
  expect(
    parseDriveLaunch(
      state({
        action: 'open',
        ids: ['file-1'],
        resourceKeys: { 'file-1': 'key-1' },
        userId: 'user-1',
      }),
    ),
  ).toEqual({
    action: 'open',
    ids: ['file-1'],
    resourceKeys: { 'file-1': 'key-1' },
    userId: 'user-1',
  })
})

it('parses a New URL state', () => {
  expect(
    parseDriveLaunch(
      state({
        action: 'create',
        folderId: 'folder-1',
        folderResourceKey: 'folder-key',
        userId: 'user-1',
      }),
    ),
  ).toEqual({
    action: 'create',
    folderId: 'folder-1',
    folderResourceKey: 'folder-key',
    userId: 'user-1',
  })
})

it('accepts a create state without a folder', () => {
  expect(
    parseDriveLaunch(state({ action: 'create', userId: 'user-1' })),
  ).toEqual({
    action: 'create',
    folderId: undefined,
    folderResourceKey: undefined,
    userId: 'user-1',
  })
})

it('parses double-encoded state', () => {
  expect(
    parseDriveLaunch(state({ action: 'open', ids: ['file-1'] }, 2)),
  ).toEqual({
    action: 'open',
    ids: ['file-1'],
    resourceKeys: {},
    userId: undefined,
  })
})

it('accepts comma-separated ids', () => {
  expect(
    parseDriveLaunch(state({ action: 'open', ids: 'file-1, file-2' })),
  ).toEqual({
    action: 'open',
    ids: ['file-1', 'file-2'],
    resourceKeys: {},
    userId: undefined,
  })
})

it('ignores malformed ids and resource keys', () => {
  expect(
    parseDriveLaunch(
      state({
        action: 'open',
        ids: ['file-1', '', 42],
        resourceKeys: { 'file-1': 'key-1', '': 'key-2', 'file-2': 7 },
      }),
    ),
  ).toEqual({
    action: 'open',
    ids: ['file-1'],
    resourceKeys: { 'file-1': 'key-1' },
    userId: undefined,
  })
})

it('falls back to direct parameters', () => {
  expect(parseDriveLaunch('?ids=file-1,file-2')).toEqual({
    action: 'open',
    ids: ['file-1', 'file-2'],
    resourceKeys: {},
  })
  expect(parseDriveLaunch('?id=file-1')).toEqual({
    action: 'open',
    ids: ['file-1'],
    resourceKeys: {},
  })
  expect(parseDriveLaunch('?folderId=folder-1')).toEqual({
    action: 'create',
    folderId: 'folder-1',
  })
})

it.each([
  '',
  '?state=not-json',
  state({ action: 'open' }),
  state({ action: 'delete', ids: ['file-1'] }),
])('rejects unusable launch data: %s', (search) => {
  expect(parseDriveLaunch(search)).toBeUndefined()
})
