import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DragPlugin } from './DragPlugin'

let capturedPluginProps: {
  anchorElem: HTMLElement
  isOnMenu: (element: HTMLElement) => boolean
  menuRef: React.RefObject<HTMLDivElement | null>
  menuComponent: React.ReactNode
  targetLineRef: React.RefObject<HTMLDivElement | null>
  targetLineComponent: React.ReactNode
} | null = null

vi.mock('@lexical/react/LexicalDraggableBlockPlugin', () => ({
  DraggableBlockPlugin_EXPERIMENTAL: (
    props: NonNullable<typeof capturedPluginProps>,
  ) => {
    capturedPluginProps = props
    return (
      <div data-testid="draggable-block-plugin">
        {props.menuComponent}
        {props.targetLineComponent}
      </div>
    )
  },
}))

let container: HTMLDivElement
let anchor: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  capturedPluginProps = null
  container = document.createElement('div')
  anchor = document.createElement('div')
  document.body.appendChild(container)
  document.body.appendChild(anchor)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  anchor.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DragPlugin', () => {
  it('wires anchorElement, menu handle, target line ref, and isOnMenu containment check', async () => {
    await act(async () => {
      root.render(<DragPlugin anchorElement={anchor} />)
    })

    expect(capturedPluginProps).not.toBeNull()
    expect(capturedPluginProps!.anchorElem).toBe(anchor)
    expect(capturedPluginProps!.menuRef.current).toBeInstanceOf(HTMLDivElement)
    expect(capturedPluginProps!.targetLineRef.current).toBeInstanceOf(
      HTMLDivElement,
    )

    const menuElement = capturedPluginProps!.menuRef.current!
    const iconElement = menuElement.querySelector('svg')!
    const outsideElement = document.createElement('div')

    expect(capturedPluginProps!.isOnMenu(menuElement)).toBe(true)
    expect(
      capturedPluginProps!.isOnMenu(iconElement as unknown as HTMLElement),
    ).toBe(true)
    expect(capturedPluginProps!.isOnMenu(outsideElement)).toBe(false)
  })
})
