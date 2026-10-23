import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerSlider,
} from './color-picker'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
})

describe('ColorPickerArea and ColorPickerSlider pointer callbacks', () => {
  it('composes consumer onPointerDown and onPointerUp on ColorPickerArea without losing internal drag behavior', async () => {
    const onPointerDown = vi.fn()
    const onPointerUp = vi.fn()
    const onValueChange = vi.fn()

    await act(() =>
      root.render(
        <ColorPicker value="#ff0000" onValueChange={onValueChange}>
          <ColorPickerArea
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          />
        </ColorPicker>,
      ),
    )

    const area = container.querySelector<HTMLElement>('[data-slot="color-picker-area"]')!
    expect(area).not.toBeNull()

    // Mock getBoundingClientRect and setPointerCapture
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    })
    area.setPointerCapture = vi.fn()

    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      area.dispatchEvent(pointerDownEvent)
    })

    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(area.getAttribute('data-dragging')).toBe('')

    const pointerUpEvent = new PointerEvent('pointerup', {
      button: 0,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      area.dispatchEvent(pointerUpEvent)
    })

    expect(onPointerUp).toHaveBeenCalledOnce()
    expect(area.getAttribute('data-dragging')).toBeNull()
  })

  it('respects defaultPrevented on consumer onPointerDown in ColorPickerArea', async () => {
    const onPointerDown = vi.fn((event: React.PointerEvent) => {
      event.preventDefault()
    })

    await act(() =>
      root.render(
        <ColorPicker value="#ff0000">
          <ColorPickerArea onPointerDown={onPointerDown} />
        </ColorPicker>,
      ),
    )

    const area = container.querySelector<HTMLElement>('[data-slot="color-picker-area"]')!
    area.setPointerCapture = vi.fn()

    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      area.dispatchEvent(pointerDownEvent)
    })

    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(area.getAttribute('data-dragging')).toBeNull()
  })

  it('composes consumer onPointerDown and onPointerUp on ColorPickerSlider', async () => {
    const onPointerDown = vi.fn()
    const onPointerUp = vi.fn()

    await act(() =>
      root.render(
        <ColorPicker value="#ff0000">
          <ColorPickerSlider
            channel="hue"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          />
        </ColorPicker>,
      ),
    )

    const slider = container.querySelector<HTMLElement>('[data-slot="color-picker-slider"]')!
    expect(slider).not.toBeNull()

    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    })
    slider.setPointerCapture = vi.fn()

    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 2,
      clientX: 50,
      clientY: 10,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      slider.dispatchEvent(pointerDownEvent)
    })

    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(slider.getAttribute('data-dragging')).toBe('')

    const pointerUpEvent = new PointerEvent('pointerup', {
      button: 0,
      pointerId: 2,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      slider.dispatchEvent(pointerUpEvent)
    })

    expect(onPointerUp).toHaveBeenCalledOnce()
    expect(slider.getAttribute('data-dragging')).toBeNull()
  })

  it('respects defaultPrevented on consumer onPointerDown in ColorPickerSlider', async () => {
    const onPointerDown = vi.fn((event: React.PointerEvent) => {
      event.preventDefault()
    })

    await act(() =>
      root.render(
        <ColorPicker value="#ff0000">
          <ColorPickerSlider channel="hue" onPointerDown={onPointerDown} />
        </ColorPicker>,
      ),
    )

    const slider = container.querySelector<HTMLElement>('[data-slot="color-picker-slider"]')!
    slider.setPointerCapture = vi.fn()

    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 2,
      clientX: 50,
      clientY: 10,
      bubbles: true,
      cancelable: true,
    })

    await act(() => {
      slider.dispatchEvent(pointerDownEvent)
    })

    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(slider.getAttribute('data-dragging')).toBeNull()
  })
})
