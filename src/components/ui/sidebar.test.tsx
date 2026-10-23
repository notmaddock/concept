import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import { Sidebar, SidebarProvider, SidebarTrigger } from './sidebar'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Sidebar DOM props forwarding', () => {
  it('forwards className, id, aria-label, style and event handlers to SheetContent when isMobile is true', async () => {
    // Force mobile matchMedia
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('max-width'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    const onClick = vi.fn()

    await act(() =>
      root.render(
        <SidebarProvider>
          <SidebarTrigger />
          <Sidebar
            id="mobile-sidebar-id"
            aria-label="Navigation Sidebar"
            className="custom-mobile-class"
            style={{ zIndex: 99 }}
            onClick={onClick}
            data-testid="mobile-sidebar"
          >
            <div>Mobile Content</div>
          </Sidebar>
        </SidebarProvider>,
      ),
    )

    // Open mobile sidebar via SidebarTrigger
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="sidebar-trigger"]',
    )!
    expect(trigger).not.toBeNull()
    await act(() => {
      trigger.click()
    })

    const sheetContent = document.querySelector<HTMLElement>('[data-slot="sidebar"]')!
    expect(sheetContent).not.toBeNull()
    expect(sheetContent.id).toBe('mobile-sidebar-id')
    expect(sheetContent.getAttribute('aria-label')).toBe('Navigation Sidebar')
    expect(sheetContent.className).toContain('custom-mobile-class')
    expect(sheetContent.style.zIndex).toBe('99')
    expect(sheetContent.style.getPropertyValue('--sidebar-width')).toBe('18rem')
    expect(sheetContent.getAttribute('data-testid')).toBe('mobile-sidebar')

    await act(() => {
      sheetContent.click()
    })
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('forwards props to container on desktop', async () => {
    // Force desktop matchMedia (no mobile query matches)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    await act(() =>
      root.render(
        <SidebarProvider defaultOpen={true}>
          <Sidebar
            id="desktop-sidebar-id"
            className="custom-desktop-class"
            style={{ opacity: '0.9' }}
            data-testid="desktop-sidebar"
          >
            <div>Desktop Content</div>
          </Sidebar>
        </SidebarProvider>,
      ),
    )

    const containerEl = document.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]',
    )!
    expect(containerEl).not.toBeNull()
    expect(containerEl.id).toBe('desktop-sidebar-id')
    expect(containerEl.className).toContain('custom-desktop-class')
    expect(containerEl.style.opacity).toBe('0.9')
    expect(containerEl.getAttribute('data-testid')).toBe('desktop-sidebar')
  })
})
