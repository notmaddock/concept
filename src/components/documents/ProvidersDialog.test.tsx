import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProvidersDialog } from './ProvidersDialog'

let root: Root
let container: HTMLDivElement
const onConnect = vi.fn(async () => {})
const onDisconnect = vi.fn()
const onOpenChange = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

async function render(connected = false, loading = false) {
  await act(() =>
    root.render(
      <ProvidersDialog
        open
        onOpenChange={onOpenChange}
        connected={connected}
        loading={loading}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    ),
  )
}

function button(label: string) {
  return Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent === label,
  )!
}

it('offers Connect or Disconnect based on connection state and disables actions while loading', async () => {
  await render()
  expect(document.body.textContent).toContain('Not connected')
  await act(() => button('Connect').click())
  expect(onConnect).toHaveBeenCalledOnce()
  expect(onDisconnect).not.toHaveBeenCalled()
  await render(false, true)
  expect(button('Connect').disabled).toBe(true)
  await render(true)
  expect(document.body.textContent).toContain('Connected')
  expect(button('Connect')).toBeUndefined()
  await act(() => button('Disconnect').click())
  expect(onDisconnect).toHaveBeenCalledOnce()
})
