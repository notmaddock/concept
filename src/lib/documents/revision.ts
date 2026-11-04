export async function documentRevision(content: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  )
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
