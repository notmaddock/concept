import { describe, expect, it } from 'vitest'
import { capabilitiesFromDrive, isDocumentCapabilities } from './capabilities'

describe('capabilitiesFromDrive', () => {
  it('maps full edit access', () => {
    expect(
      capabilitiesFromDrive({ canEdit: true, canModifyContent: true, canComment: true }),
    ).toEqual({ view: true, edit: true, comment: true })
  })

  it('treats canEdit false as read-only, mirroring isDriveFileReadOnly', () => {
    expect(capabilitiesFromDrive({ canEdit: false, canModifyContent: true }).edit).toBe(false)
    expect(capabilitiesFromDrive({ canEdit: true, canModifyContent: false }).edit).toBe(false)
  })

  it('treats missing flags as editable, mirroring isDriveFileReadOnly', () => {
    expect(capabilitiesFromDrive(undefined).edit).toBe(true)
    expect(capabilitiesFromDrive({}).edit).toBe(true)
  })

  it('maps comment only when canComment is true', () => {
    expect(capabilitiesFromDrive({ canComment: true }).comment).toBe(true)
    expect(capabilitiesFromDrive({ canComment: false }).comment).toBe(false)
    expect(capabilitiesFromDrive(undefined).comment).toBe(false)
  })
})

describe('isDocumentCapabilities', () => {
  it('accepts well-formed objects and rejects the rest', () => {
    expect(isDocumentCapabilities({ view: true, edit: false, comment: false })).toBe(true)
    expect(isDocumentCapabilities({ view: true, edit: false })).toBe(false)
    expect(isDocumentCapabilities(null)).toBe(false)
    expect(isDocumentCapabilities('view')).toBe(false)
  })
})
