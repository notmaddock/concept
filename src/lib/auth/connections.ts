export const googlePermissions = [
  {
    id: 'drive-files',
    label: 'Concept files in Google Drive',
    description:
      'Create, find, and update files opened or created with Concept.',
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.install',
    ],
  },
] as const

export function hasScopes(
  granted: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
) {
  return required.every((scope) => granted.includes(scope))
}
