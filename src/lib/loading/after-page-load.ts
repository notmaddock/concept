export function afterPageLoad(task: () => Promise<unknown>) {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  const run = () => {
    if (!cancelled) void task().catch(() => {})
  }
  const schedule = () => {
    if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(run, { timeout: 2000 })
    } else {
      timer = setTimeout(run, 200)
    }
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    cancelled = true
    window.removeEventListener('load', schedule)
    if (timer !== undefined) clearTimeout(timer)
    if (idle !== undefined) window.cancelIdleCallback(idle)
  }
}
