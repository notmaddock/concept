import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, vi } from 'vitest'

export interface TestRootHarness {
  readonly container: HTMLDivElement
  readonly root: Root
  render: (node: ReactNode) => Promise<HTMLDivElement>
}

export function setupTestRoot(): TestRootHarness {
  let currentContainer: HTMLDivElement | undefined
  let currentRoot: Root | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    currentContainer = document.createElement('div')
    document.body.append(currentContainer)
    currentRoot = createRoot(currentContainer)
  })

  afterEach(async () => {
    await act(async () => currentRoot?.unmount())
    currentContainer?.remove()
    vi.unstubAllGlobals()
  })

  return {
    get container() {
      return currentContainer!
    },
    get root() {
      return currentRoot!
    },
    async render(node: ReactNode) {
      await act(async () => {
        currentRoot!.render(node)
      })
      return currentContainer!
    },
  }
}
