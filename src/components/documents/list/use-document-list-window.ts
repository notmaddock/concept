import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

const ROW_HEIGHT = 34
const OVERSCAN = 6
const INITIAL_VIEWPORT_HEIGHT = 600
const VIRTUALIZATION_THRESHOLD = 60

export interface DocumentListWindow {
  listRef: RefObject<HTMLUListElement | null>
  virtual: boolean
  indexes: number[]
  focusedIndex: number | null
  setFocusedIndex: Dispatch<SetStateAction<number | null>>
  focus: (index: number) => void
  rowHeight: number
}

export function useDocumentListWindow(
  count: number,
  activeIndex: number,
): DocumentListWindow {
  const listRef = useRef<HTMLUListElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const [viewport, setViewport] = useState({
    top: 0,
    height: INITIAL_VIEWPORT_HEIGHT,
  })
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [pendingFocus, setPendingFocus] = useState<number | null>(null)
  const virtual = count > VIRTUALIZATION_THRESHOLD

  useEffect(() => {
    const list = listRef.current
    const scroller = list?.closest<HTMLElement>('[data-sidebar="content"]')
    if (!list || !scroller) return
    scrollerRef.current = scroller
    if (!virtual) {
      return () => {
        scrollerRef.current = null
      }
    }
    let frame = 0
    const measure = () => {
      const top = Math.max(
        0,
        scroller.getBoundingClientRect().top - list.getBoundingClientRect().top,
      )
      const height = scroller.clientHeight || INITIAL_VIEWPORT_HEIGHT
      setViewport((previous) =>
        previous.top === top && previous.height === height
          ? previous
          : { top, height },
      )
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
      scrollerRef.current = null
    }
  }, [virtual])

  function reveal(index: number) {
    const list = listRef.current
    const scroller =
      scrollerRef.current ??
      list?.closest<HTMLElement>('[data-sidebar="content"]') ??
      null
    if (!list || !scroller) return
    scrollerRef.current = scroller
    const offset =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop
    const top = offset + index * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = Math.max(
        0,
        bottom - (scroller.clientHeight || INITIAL_VIEWPORT_HEIGHT),
      )
    const relativeTop = Math.max(0, scroller.scrollTop - offset)
    setViewport({
      top: relativeTop,
      height: scroller.clientHeight || INITIAL_VIEWPORT_HEIGHT,
    })
  }

  useEffect(() => {
    if (activeIndex >= 0) reveal(activeIndex)
  }, [activeIndex, virtual])

  const start = virtual
    ? Math.max(
        0,
        Math.min(count - 1, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN),
      )
    : 0
  const end = virtual
    ? Math.min(
        count,
        Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
      )
    : count
  const indexes = Array.from(
    { length: Math.max(0, end - start) },
    (_, offset) => start + offset,
  )
  if (virtual) {
    for (const index of [focusedIndex, pendingFocus]) {
      if (
        index !== null &&
        index >= 0 &&
        index < count &&
        !indexes.includes(index)
      )
        indexes.push(index)
    }
    indexes.sort((a, b) => a - b)
  }

  useLayoutEffect(() => {
    const index = pendingFocus
    if (index === null) return
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-document-index="${index}"] a`,
    )
    if (target) {
      target.focus({ preventScroll: true })
      setPendingFocus(null)
    }
  }, [pendingFocus])

  function focus(index: number) {
    setPendingFocus(index)
    reveal(index)
  }

  return {
    listRef,
    virtual,
    indexes,
    focusedIndex,
    setFocusedIndex,
    focus,
    rowHeight: ROW_HEIGHT,
  }
}
