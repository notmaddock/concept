const lifecycleTasks = new Map<string, Promise<unknown>>()

// Document and asset persistence share one queue, including browsers without Web Locks.
export function withDocumentLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator)
    return navigator.locks.request(`concept-document-lifecycle:${id}`, task)
  const previous = lifecycleTasks.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  lifecycleTasks.set(id, current)
  void current
    .finally(() => {
      if (lifecycleTasks.get(id) === current) lifecycleTasks.delete(id)
    })
    .catch(() => {})
  return current
}
