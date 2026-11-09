export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} bytes`
  return `${(bytes / 1024 ** (bytes >= 1024 ** 2 ? 2 : 1)).toFixed(1)} ${bytes >= 1024 ** 2 ? 'MB' : 'KB'} (${bytes.toLocaleString()} bytes)`
}
