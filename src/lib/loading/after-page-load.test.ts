import { afterEach, expect, it, vi } from 'vitest'
import { afterPageLoad } from './after-page-load'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('waits until page load before scheduling background imports', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const task = vi.fn().mockResolvedValue(undefined)
  const cancel = afterPageLoad(task)
  await vi.runAllTimersAsync()
  expect(task).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('load'))
  await vi.runAllTimersAsync()
  expect(task).toHaveBeenCalledOnce()
  cancel()
})

it('cancels background imports when the owning component unmounts', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  const task = vi.fn().mockResolvedValue(undefined)
  const cancel = afterPageLoad(task)
  cancel()
  await vi.runAllTimersAsync()
  expect(task).not.toHaveBeenCalled()
})
