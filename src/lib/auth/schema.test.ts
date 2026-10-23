// @vitest-environment node
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'

let database: DatabaseSync
beforeEach(() => {
  database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    '0001_auth.sql',
    '0002_passkeys.sql',
    '0003_sign_in_guards.sql',
    '0004_storage_consent.sql',
  ]) {
    database.exec(
      readFileSync(
        new URL(`../../../migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    )
  }
  database.exec(`INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES ('user-1', 'Example', 'example@example.com', 0, 0);
    INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('google-1', 'subject', 'google', 'user-1', 0, 0);`)
})
afterEach(() => database.close())

function addPasskey(id: string) {
  database
    .prepare(
      'INSERT INTO passkey (id, publicKey, userId, credentialID, counter, deviceType, backedUp) VALUES (?, ?, ?, ?, 0, ?, 0)',
    )
    .run(id, 'public-key', 'user-1', id, 'singleDevice')
}

it('rejects unlinking the only sign-in method', () => {
  expect(() =>
    database.exec("DELETE FROM account WHERE id = 'google-1'"),
  ).toThrow('Add another sign-in method')
})

it('allows replacing Google with a passkey and protects that last passkey', () => {
  addPasskey('key-1')
  database.exec("DELETE FROM account WHERE id = 'google-1'")
  expect(() => database.exec("DELETE FROM passkey WHERE id = 'key-1'")).toThrow(
    'Add another sign-in method',
  )
  addPasskey('key-2')
  database.exec("DELETE FROM passkey WHERE id = 'key-1'")
  expect(() => database.exec("DELETE FROM passkey WHERE id = 'key-2'")).toThrow(
    'Add another sign-in method',
  )
})

it('allows removing a passkey when Google remains available', () => {
  addPasskey('key-1')
  expect(() =>
    database.exec("DELETE FROM passkey WHERE id = 'key-1'"),
  ).not.toThrow()
})

it('allows cascading user deletion without the sign-in guard blocking cleanup', () => {
  addPasskey('key-1')
  database.exec("DELETE FROM user WHERE id = 'user-1'")
  expect(
    database.prepare('SELECT COUNT(*) AS count FROM account').get()?.count,
  ).toBe(0)
  expect(
    database.prepare('SELECT COUNT(*) AS count FROM passkey').get()?.count,
  ).toBe(0)
})

it('defaults relinked accounts to disconnected even when Google returns prior Drive grants', () => {
  addPasskey('key-1')
  database.exec("DELETE FROM account WHERE id = 'google-1'")
  database
    .prepare(
      'INSERT INTO account (id, accountId, providerId, userId, scope, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, 0)',
    )
    .run(
      'relinked',
      'subject',
      'google',
      'user-1',
      'https://www.googleapis.com/auth/drive.file',
    )
  expect(
    database
      .prepare('SELECT driveConnected FROM account WHERE id = ?')
      .get('relinked')?.driveConnected,
  ).toBe(0)
})
