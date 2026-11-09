import { describe, expect, it, vi } from 'vitest'
import { createListenerSet } from './listener'

describe('createListenerSet', () => {
  it('notifies registered listeners and tracks size', () => {
    const set = createListenerSet()
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const unsub1 = set.subscribe(fn1)
    const unsub2 = set.subscribe(fn2)
    expect(set.size).toBe(2)

    set.notify()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)

    unsub1()
    expect(set.size).toBe(1)

    set.notify()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(2)

    unsub2()
    expect(set.size).toBe(0)
  })

  it('snapshots listeners so re-entrant subscriptions do not execute in current pass', () => {
    const set = createListenerSet()
    const order: string[] = []

    set.subscribe(() => {
      order.push('first')
      set.subscribe(() => {
        order.push('nested')
      })
    })

    set.notify()
    expect(order).toEqual(['first'])

    set.notify()
    expect(order).toEqual(['first', 'first', 'nested'])
  })

  it('skips listeners unsubscribed during the current notification pass', () => {
    const set = createListenerSet()
    const order: string[] = []
    let unsub2 = () => {}

    set.subscribe(() => {
      order.push('first')
      unsub2()
    })
    unsub2 = set.subscribe(() => {
      order.push('second')
    })

    set.notify()
    expect(order).toEqual(['first'])
  })

  it('isolates listener exceptions and continues dispatching', () => {
    const set = createListenerSet()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fn = vi.fn()

    set.subscribe(() => {
      throw new Error('boom')
    })
    set.subscribe(fn)

    set.notify()
    expect(consoleSpy).toHaveBeenCalledWith(
      '[listener] callback failed:',
      expect.any(Error),
    )
    expect(fn).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it('clears all listeners', () => {
    const set = createListenerSet()
    const fn = vi.fn()
    set.subscribe(fn)
    expect(set.size).toBe(1)

    set.clear()
    expect(set.size).toBe(0)
    set.notify()
    expect(fn).not.toHaveBeenCalled()
  })
})
