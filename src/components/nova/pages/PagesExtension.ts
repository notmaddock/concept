import { effect, namedSignals } from '@lexical/extension'
import {
  $addUpdateTag,
  $createNodeSelection,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNearestRootOrShadowRoot,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $getStateChange,
  $isDecoratorNode,
  $isRangeSelection,
  $onUpdate,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  defineExtension,
  HISTORY_MERGE_TAG,
  mergeRegister,
  RootNode,
  safeCast,
  SELECTION_CHANGE_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical'
import type { NodeKey } from 'lexical'
import { $getPageSetup, pageSetupState } from '#/lib/documents/page-setup'
import { $isPageBreakNode } from './PageBreakNode'
import type { PageBreakNode } from './PageBreakNode'
import { PageBreakExtension } from './PageBreakExtension'
import {
  $createPageContentNode,
  $isPageContentNode,
  PageContentNode,
} from './PageContentNode'
import { $createPageNode, $isPageNode, PageNode } from './PageNode'
import { formatPx, pageBoxPx } from './page-layout'

export interface PagesConfig {
  disabled: boolean
  pageClass: string
  pageContentClass: string
}

const requestFrame = (callback: FrameRequestCallback): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)

const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id)
  } else {
    clearTimeout(id)
  }
}

const createResizeObserver = (
  callback: ResizeObserverCallback,
): ResizeObserver | null =>
  typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(callback)

/**
 * Automatic pagination for the document editor.
 *
 * The extension is dormant while the document is pageless. Switching the root
 * page setup to `paper` wraps every root child in a PageNode, then re-flows
 * content between pages as the DOM is measured. Switching back unwraps the
 * pages so the editor returns to the continuous canvas.
 */
export const PagesExtension = defineExtension({
  build: (_editor, config) => namedSignals({ disabled: config.disabled }),
  config: safeCast<PagesConfig>({
    disabled: false,
    pageClass: 'concept-page',
    pageContentClass: 'concept-page-content',
  }),
  dependencies: [PageBreakExtension],
  name: '@concept/pages',
  nodes: () => [PageNode, PageContentNode],
  register: (editor, _config, state) =>
    effect(() => {
      const output = state.getOutput()
      if (output.disabled.value) return

      let rafId: number | null = null
      let previousPageKey: NodeKey | null = null
      const fixedPageHeights = new Map<NodeKey, number>()
      const pagesMarkedForMeasurement = new Set<NodeKey>()

      const clearMeasurementFlags = () => {
        fixedPageHeights.clear()
        pagesMarkedForMeasurement.clear()
      }
      const markForMeasurement = (node: PageNode) =>
        pagesMarkedForMeasurement.add(node.getKey())

      const $getPagesMarkedForMeasurement = () => {
        const pages: PageNode[] = []
        for (const key of pagesMarkedForMeasurement) {
          const page = $getNodeByKey(key)
          if ($isPageNode(page) && page.isAttached()) {
            pages.push(page)
          }
        }
        return pages
      }

      const getPageHeight = (rootElement: HTMLElement) => {
        const pageHeight = parseFloat(
          rootElement.style.getPropertyValue('--page-height'),
        )
        return Number.isFinite(pageHeight) ? pageHeight : 0
      }

      // Measures the natural content height of a page by temporarily removing
      // the min-height constraint and reading scrollHeight.
      const measureHeight = (node: PageNode) => {
        pagesMarkedForMeasurement.delete(node.getKey())
        const element = editor.getElementByKey(node.getKey())
        if (!element) return 0
        element.style.minHeight = 'unset'
        const height = element.scrollHeight
        element.style.minHeight = ''
        return height
      }

      // Determines which children from the next page can be pulled back into
      // this page without exceeding the page height. Returns the child nodes
      // that fit, using DOM cloning to simulate the layout.
      const $getUnderflowingChildren = (node: PageNode) => {
        const rootElement = editor.getRootElement()
        if (!rootElement) return []
        const pageElement = node.getPageElement()
        if (!pageElement) return []
        const contentElement = node.getPageContentElement()
        if (!contentElement) return []
        const nextPage = node.getNextSibling()
        if (!$isPageNode(nextPage)) return []
        const nextPageContentNode = nextPage.getContentNode()
        const nextPageContentChildren = nextPageContentNode.getChildren()
        if (!nextPageContentChildren.length) return []
        const nextPageContentElement = nextPage.getPageContentElement()
        if (!nextPageContentElement) return []
        const nextPageChildNodes = Array.from(nextPageContentElement.childNodes)
        // Decorator nodes are rendered by React outside of the content
        // element's child list until they commit; measuring a partial page
        // would move the wrong blocks.
        if (
          nextPageChildNodes.length !== nextPageContentChildren.length ||
          nextPageContentChildren.some(
            (child) =>
              $isDecoratorNode(child) &&
              !editor.getElementByKey(child.getKey()),
          )
        ) {
          return []
        }
        pageElement.style.minHeight = 'unset'
        const pageHeight = getPageHeight(rootElement)
        if (!pageHeight) {
          pageElement.style.minHeight = ''
          return []
        }
        let overflowAfterIndex = 0
        let currentPageHeight = pageElement.scrollHeight
        while (currentPageHeight < pageHeight) {
          if (overflowAfterIndex >= nextPageChildNodes.length) break
          const nextChild =
            nextPageChildNodes[overflowAfterIndex].cloneNode(true)
          contentElement.appendChild(nextChild)
          currentPageHeight = pageElement.scrollHeight
          if (currentPageHeight > pageHeight) {
            nextChild.parentNode?.removeChild(nextChild)
            break
          }
          overflowAfterIndex++
          fixedPageHeights.set(node.getKey(), currentPageHeight)
        }
        pageElement.style.minHeight = ''
        if (overflowAfterIndex === 0) return []
        return nextPageContentChildren.slice(0, overflowAfterIndex)
      }

      // Determines which children overflow beyond the page height by
      // temporarily removing DOM nodes from the end until the page fits.
      // Returns the Lexical nodes that should be moved to the next page.
      const $getOverflowingChildren = (node: PageNode) => {
        const rootElement = editor.getRootElement()
        if (!rootElement) return []
        const pageElement = node.getPageElement()
        if (!pageElement) return []
        const contentElement = node.getPageContentElement()
        const contentNode = node.getContentNode()
        if (!contentElement) return []
        const children = contentNode.getChildren()
        let childNodes = Array.from(contentElement.childNodes)
        if (children.length !== childNodes.length) {
          // Measure this update's children, which may still be rendered on
          // another page. Decorator nodes without a committed element cannot
          // be measured, so leave the page alone until the next frame.
          const domNodes = children.flatMap((child) => {
            const dom = editor.getElementByKey(child.getKey())
            return dom ? [dom] : []
          })
          if (domNodes.length !== children.length) return []
          contentElement.replaceChildren(...domNodes)
          childNodes = Array.from(contentElement.childNodes)
          if (childNodes.length !== children.length) return []
        }
        if (
          children.some(
            (child) =>
              $isDecoratorNode(child) &&
              !editor.getElementByKey(child.getKey()),
          )
        ) {
          return []
        }
        pageElement.style.minHeight = 'unset'
        const pageHeight = getPageHeight(rootElement)
        if (!pageHeight) {
          pageElement.style.minHeight = ''
          return []
        }
        let currentPageHeight = pageElement.scrollHeight
        let overflowAfterIndex = children.length - 1
        while (currentPageHeight > pageHeight) {
          if (overflowAfterIndex < 0) break
          childNodes[overflowAfterIndex].remove()
          currentPageHeight = pageElement.scrollHeight
          fixedPageHeights.set(node.getKey(), currentPageHeight)
          if (currentPageHeight < pageHeight) break
          overflowAfterIndex--
        }
        pageElement.style.minHeight = ''
        return children.slice(Math.max(overflowAfterIndex, 0) || 1)
      }

      // Measures a page's content height and dispatches to $fixOverflow or
      // $fixUnderflow as needed. Skips if the height hasn't changed since the
      // last measurement to avoid redundant work.
      const $fixFlow = (node: PageNode) => {
        if (!node.isAttached()) {
          pagesMarkedForMeasurement.delete(node.getKey())
          return
        }
        const rootElement = editor.getRootElement()
        if (!rootElement) return
        const pageHeight = getPageHeight(rootElement)
        const fixedPageHeight = fixedPageHeights.get(node.getKey())
        const currentPageHeight = measureHeight(node)
        if (!pageHeight || !currentPageHeight) return
        if (currentPageHeight === fixedPageHeight) return
        if (currentPageHeight > pageHeight) {
          $fixOverflow(node)
        } else {
          $fixUnderflow(node)
        }
      }

      // Moves children that exceed the page height to the next page.
      // If no next page exists, creates one and appends the overflow to it.
      const $fixOverflow = (node: PageNode) => {
        const contentNode = node.getContentNode()
        const childrenSize = contentNode.getChildrenSize()
        if (childrenSize === 1) return
        const overflowingChildren = $getOverflowingChildren(node)
        if (!overflowingChildren.length) return
        const nextSibling = node.getNextSibling()
        if ($isPageNode(nextSibling)) {
          const nextContent = nextSibling.getContentNode()
          const nextPageFirstChild = nextContent.getFirstChild()
          if (!nextPageFirstChild) return
          overflowingChildren.forEach((child) => {
            nextPageFirstChild.insertBefore(child)
          })
        } else {
          const newPage = $createPageNode()
          newPage.getContentNode().append(...overflowingChildren)
          node.insertAfter(newPage)
        }
      }

      // Pulls children from the next page to fill remaining space on this page.
      // Removes the next page entirely if all its children were pulled back.
      // Removes the current page if it has no children at all.
      const $fixUnderflow = (node: PageNode) => {
        const contentNode = node.getContentNode()
        const childrenSize = contentNode.getChildrenSize()
        if (!childrenSize) {
          node.remove()
          return
        }
        const nextSibling = node.getNextSibling()
        if (!$isPageNode(nextSibling)) return
        const nextContent = nextSibling.getContentNode()
        const nextPageChildrenSize = nextContent.getChildrenSize()
        if (nextPageChildrenSize === 0) return
        const underflowingChildren = $getUnderflowingChildren(node)
        if (!underflowingChildren.length) return
        contentNode.append(...underflowingChildren)
        if (nextPageChildrenSize !== underflowingChildren.length) return
        nextSibling.remove()
      }

      // Scales the editor so that pages fit within the available root width
      // without horizontal scrolling, capped at 1x zoom.
      const updateZoom = () => {
        const rootElement = editor.getRootElement()
        if (!rootElement) return
        const pageWidth = parseFloat(
          rootElement.style.getPropertyValue('--page-width'),
        )
        if (!pageWidth) return
        const rootWidth = rootElement.getBoundingClientRect().width
        if (!rootWidth) return
        const padding = parseFloat(getComputedStyle(rootElement).paddingLeft)
        const rootPadding = Number.isFinite(padding) ? padding * 2 : 0
        const nextZoom = Math.min(rootWidth / (pageWidth + rootPadding), 1)
        const zoom = nextZoom.toFixed(6)
        if (zoom === rootElement.style.zoom) return
        rootElement.style.zoom = zoom
      }

      // Reads the current page setup and applies the corresponding CSS custom
      // properties to the root element, or removes them when pageless.
      const updatePageDimensions = () => {
        editor.read('latest', () => {
          const setup = $getPageSetup()
          const rootElement = editor.getRootElement()
          if (!rootElement) return
          if (setup.mode === 'paper') {
            const box = pageBoxPx(setup)
            rootElement.style.setProperty('--page-width', formatPx(box.width))
            rootElement.style.setProperty('--page-height', formatPx(box.height))
            for (const side of ['top', 'right', 'bottom', 'left'] as const) {
              rootElement.style.setProperty(
                `--page-margin-${side}`,
                formatPx(box.margins[side]),
              )
            }
            updateZoom()
          } else {
            rootElement.style.removeProperty('--page-width')
            rootElement.style.removeProperty('--page-height')
            rootElement.style.removeProperty('--page-margin-top')
            rootElement.style.removeProperty('--page-margin-right')
            rootElement.style.removeProperty('--page-margin-bottom')
            rootElement.style.removeProperty('--page-margin-left')
            rootElement.style.zoom = ''
          }
        })
      }

      // Debounces page re-flow via requestAnimationFrame: on the next frame,
      // runs fixFlow() on every page marked for measurement to redistribute
      // content that overflows or underflows a page's available height.
      const schedulePageMeasurement = () => {
        if (rafId !== null) cancelFrame(rafId)
        rafId = requestFrame(() => {
          rafId = null
          editor.update(() => {
            const pages = $getPagesMarkedForMeasurement()
            if (pages.length === 0) return
            $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG)
            $addUpdateTag(HISTORY_MERGE_TAG)
            for (const page of pages) {
              $fixFlow(page)
            }
          })
        })
      }

      // Ensures all root-level children are properly wrapped in PageNodes.
      // Moves stray content into the nearest page, handles PageBreakNodes by
      // splitting content across pages, and creates a default empty page if
      // none exist.
      const fixPageStructure = () => {
        editor.update(
          () => {
            const root = $getRoot()
            const children = root.getChildren()
            const pages: (PageNode | PageBreakNode)[] = []
            for (const child of children) {
              if ($isPageNode(child) || $isPageBreakNode(child)) {
                if ($isPageNode(child)) {
                  pages.push(child)
                  const contentNode = child.getContentNode()
                  const pageBreakNode = contentNode
                    .getChildren()
                    .find($isPageBreakNode)
                  if (pageBreakNode) {
                    pages.push(pageBreakNode)
                    const nextSiblings = pageBreakNode.getNextSiblings()
                    const nextPage = child.getNextPage()
                    if (nextPage) {
                      for (let i = nextSiblings.length - 1; i >= 0; i--) {
                        nextPage
                          .getContentNode()
                          .getFirstChild()
                          ?.insertBefore(nextSiblings[i])
                      }
                    } else {
                      const newPage = $createPageNode()
                      pages.push(newPage)
                      if (nextSiblings.length > 0) {
                        for (const sibling of nextSiblings) {
                          newPage.getContentNode().append(sibling)
                        }
                      } else {
                        newPage.getContentNode().append($createParagraphNode())
                      }
                    }
                  }
                } else {
                  pages.push(child)
                }
              } else {
                const lastPage = pages[pages.length - 1]
                if ($isPageNode(lastPage)) {
                  lastPage.getContentNode().append(child)
                } else {
                  const newPage = $createPageNode()
                  newPage.getContentNode().append(child)
                  pages.push(newPage)
                }
              }
            }
            root.splice(0, root.getChildrenSize(), pages)
            for (const page of pages) {
              if ($isPageNode(page)) {
                markForMeasurement(page)
              }
            }
            if (!pages.some($isPageNode)) {
              const newPage = $createPageNode()
              const paragraph = $createParagraphNode()
              newPage.getContentNode().append(paragraph)
              root.append(newPage)
              paragraph.selectStart()
              markForMeasurement(newPage)
            }
            schedulePageMeasurement()
          },
          { discrete: true },
        )
      }

      // Marks the first page of each page-break group for measurement and
      // schedules re-flow, used when page dimensions change and all pages
      // need to be re-measured.
      const resizePages = () => {
        editor.read(() => {
          const root = $getRoot()
          const children = root.getChildren()
          clearMeasurementFlags()
          for (const child of children) {
            if (!$isPageNode(child)) continue
            if ($isPageNode(child.getPreviousSibling())) continue
            markForMeasurement(child)
          }
          schedulePageMeasurement()
        })
      }

      // Removes all PageNode wrappers, moving their content back to the root
      // as direct children. Used when paged mode is turned off.
      const destroyPageStructure = () => {
        editor.update(
          () => {
            const root = $getRoot()
            for (const child of root.getChildren()) {
              if (!$isPageNode(child)) continue
              const contentNode = child.getChildren().find($isPageContentNode)
              if (!contentNode) {
                child.remove()
                continue
              }
              contentNode.getChildren().forEach((node) => {
                child.insertBefore(node)
              })
              child.remove()
            }
          },
          { tag: HISTORY_MERGE_TAG },
        )
      }

      return editor.registerRootListener((rootElement) => {
        if (!rootElement) return
        return effect(() => {
          const rootObserver = createResizeObserver(updateZoom)
          rootObserver?.observe(rootElement)

          // Watches the focused page's content element for size changes
          // and marks the affected page (and its predecessor) for
          // re-measurement.
          const pageObserver = createResizeObserver((entries) => {
            const pageContent = entries[0]?.target as HTMLElement | undefined
            if (!pageContent) return
            editor.read(() => {
              const pageContentNode = $getNearestNodeFromDOMNode(pageContent)
              if (!$isPageContentNode(pageContentNode)) return
              const pageNode = pageContentNode.getParent()
              if (!$isPageNode(pageNode)) return
              const previousPage = pageNode.getPreviousPage()
              if (previousPage) {
                fixedPageHeights.delete(previousPage.getKey())
                markForMeasurement(previousPage)
              }
              markForMeasurement(pageNode)
              schedulePageMeasurement()
            })
          })

          // Root transform callback: checks whether the root's children are
          // valid (all PageNodes, no stray content, no PageBreakNodes inside
          // PageContentNodes). If invalid, queues fixPageStructure as a
          // microtask.
          const $enforcePageStructure = () => {
            if (!editor.isEditable()) return
            if ($getPageSetup().mode !== 'paper') return
            const root = $getRoot()
            const children = root.getChildren()
            const isInvalid =
              !children.some($isPageNode) ||
              children.some(
                (child) => !$isPageNode(child) && !$isPageBreakNode(child),
              ) ||
              children.some(
                (child) =>
                  $isPageNode(child) &&
                  child.getContentNode().getChildren().some($isPageBreakNode),
              )
            if (isInvalid) {
              queueMicrotask(fixPageStructure)
            }
          }

          // Normalizes a PageNode so it has exactly one PageContentNode child.
          // Any stray children (e.g. from paste) are moved into the content
          // node.
          const $ensurePageNodeChildren = (pageNode: PageNode) => {
            const children = pageNode.getChildren()
            let content: PageContentNode | undefined
            const strayChildren: typeof children = []
            for (const child of children) {
              if ($isPageContentNode(child)) {
                content = child
              } else {
                strayChildren.push(child)
              }
            }
            if (content && strayChildren.length === 0) return
            if (!content) {
              content = $createPageContentNode()
            }
            if (strayChildren.length > 0) {
              content.append(...strayChildren)
            } else {
              content.append($createParagraphNode())
            }
            pageNode.clear()
            pageNode.append(content)
          }

          // When a PageNode changes, ensure its structure is valid and
          // schedule measurement to fix overflow/underflow before next paint.
          const removePageTransform = editor.registerNodeTransform(
            PageNode,
            (pageNode) => {
              $ensurePageNodeChildren(pageNode)
              if (pagesMarkedForMeasurement.has(pageNode.getKey())) return
              markForMeasurement(pageNode)
              schedulePageMeasurement()
            },
          )

          const removeRootTransform = editor.registerNodeTransform(
            RootNode,
            $enforcePageStructure,
          )

          // When PageContentNode content changes, mark its parent page for
          // re-measurement so overflow/underflow is corrected.
          const removePageContentTransform = editor.registerNodeTransform(
            PageContentNode,
            (node) => {
              const pageNode = node.getPageNode()
              if (pagesMarkedForMeasurement.has(pageNode.getKey())) return
              markForMeasurement(pageNode)
              schedulePageMeasurement()
            },
          )

          const removeCommandListeners = mergeRegister(
            // Tracks the currently focused page so a ResizeObserver can watch
            // only its content element, avoiding unnecessary observation of
            // every page. Unobserves the previous page when focus moves.
            editor.registerCommand(
              SELECTION_CHANGE_COMMAND,
              () => {
                $onUpdate(() =>
                  editor.read('latest', () => {
                    if ($getPageSetup().mode !== 'paper') return false
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return false
                    const anchorNode = selection.anchor.getNode()
                    const nearestRoot =
                      anchorNode.getKey() === 'root'
                        ? anchorNode
                        : $getNearestRootOrShadowRoot(anchorNode)
                    if (!$isPageContentNode(nearestRoot)) return false
                    const currentPage = nearestRoot.getPageNode()
                    const currentPageKey = currentPage.getKey()
                    const oldPreviousPageKey = previousPageKey
                    const pageContentElement =
                      currentPage.getPageContentElement()
                    if (!pageContentElement) return false
                    previousPageKey = currentPageKey
                    pageObserver?.observe(pageContentElement)
                    if (
                      oldPreviousPageKey === null ||
                      oldPreviousPageKey === currentPageKey
                    ) {
                      return false
                    }
                    const previousPage = $getNodeByKey(oldPreviousPageKey)
                    if (!$isPageNode(previousPage)) return false
                    const previousPageContent =
                      previousPage.getPageContentElement()
                    if (!previousPageContent) return false
                    pageObserver?.unobserve(previousPageContent)
                    return false
                  }),
                )
                return false
              },
              COMMAND_PRIORITY_LOW,
            ),
            // Handles character deletion at page boundaries: backspace at the
            // start of a page merges content into the previous page, and
            // forward delete at the end pulls content from the next page.
            // Also handles removing an empty page on backspace.
            editor.registerCommand(
              DELETE_CHARACTER_COMMAND,
              (isBackward: boolean) => {
                if ($getPageSetup().mode !== 'paper') return false
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                  return false
                }

                const anchorNode = selection.anchor.getNode()
                const nearestRoot =
                  anchorNode.getKey() === 'root'
                    ? anchorNode
                    : $getNearestRootOrShadowRoot(anchorNode)
                if (!$isPageContentNode(nearestRoot)) return false

                const contentChildrenSize = nearestRoot.getChildrenSize()
                const isEmpty =
                  contentChildrenSize === 1 &&
                  nearestRoot.getTextContentSize() === 0
                if (isEmpty && isBackward) {
                  const pageNode = nearestRoot.getPageNode()
                  const previousSibling = pageNode.getPreviousSibling()
                  pageNode.remove()
                  if ($isPageNode(previousSibling)) {
                    previousSibling.getContentNode().selectEnd()
                  } else if ($isPageBreakNode(previousSibling)) {
                    const nodeSelection = $createNodeSelection()
                    nodeSelection.add(previousSibling.getKey())
                    $setSelection(nodeSelection)
                  } else {
                    pageNode.selectPrevious()
                  }
                  return true
                }

                if (isBackward && selection.anchor.offset === 0) {
                  const topLevelElement = anchorNode.getTopLevelElement()
                  if (topLevelElement === null) return false
                  if (topLevelElement.getIndexWithinParent() !== 0) return false
                  const previousSibling = nearestRoot
                    .getPageNode()
                    .getPreviousSibling()
                  if (!$isPageNode(previousSibling)) return false
                  previousSibling.getContentNode().append(topLevelElement)
                  topLevelElement.selectStart().deleteCharacter(true)
                  return true
                } else if (
                  !isBackward &&
                  selection.anchor.offset === anchorNode.getTextContentSize()
                ) {
                  const topLevelElement = anchorNode.getTopLevelElement()
                  if (topLevelElement === null) return false
                  if (
                    topLevelElement.getIndexWithinParent() !==
                    contentChildrenSize - 1
                  ) {
                    return false
                  }
                  const nextSibling = nearestRoot.getPageNode().getNextSibling()
                  if (!$isPageNode(nextSibling)) return false
                  const nextPageContent = nextSibling.getContentNode()
                  const nextPageFirstChild = nextPageContent.getFirstChild()
                  if (!nextPageFirstChild) return false
                  nearestRoot.append(nextPageFirstChild)
                  nextPageFirstChild.selectStart().deleteCharacter(true)
                  return true
                }
                return false
              },
              COMMAND_PRIORITY_LOW,
            ),
          )

          const removeMutationListeners = mergeRegister(
            // Watches for page setup changes on the root node. When the
            // document becomes pageless, destroys the page structure; when it
            // becomes paged, updates CSS dimensions and wraps or resizes.
            editor.registerMutationListener(
              RootNode,
              (_mutations, { prevEditorState }) => {
                const change = $getStateChange(
                  editor.read('latest', $getRoot),
                  prevEditorState.read($getRoot),
                  pageSetupState,
                )
                if (!change) return
                updatePageDimensions()
                const [pageState] = change
                if (pageState.mode !== 'paper') {
                  queueMicrotask(destroyPageStructure)
                  return
                }
                const hasPages = editor
                  .getEditorState()
                  .read(() => $getRoot().getChildren().some($isPageNode))
                if (hasPages) {
                  resizePages()
                } else {
                  queueMicrotask(fixPageStructure)
                }
              },
            ),
          )

          const applyCurrentSetup = () => {
            updatePageDimensions()
            const setup = editor.getEditorState().read($getPageSetup)
            const hasPages = editor
              .getEditorState()
              .read(() => $getRoot().getChildren().some($isPageNode))
            if (setup.mode === 'paper') {
              if (hasPages) {
                resizePages()
              } else {
                fixPageStructure()
              }
            } else if (hasPages) {
              destroyPageStructure()
            }
          }

          applyCurrentSetup()

          return mergeRegister(
            // Placed first so mergeRegister's reverse (LIFO) teardown runs it
            // last, only after every listener and transform below has been
            // torn down.
            () => {
              if (rafId !== null) {
                cancelFrame(rafId)
                rafId = null
              }
              pageObserver?.disconnect()
              rootObserver?.disconnect()
              if (output.disabled.peek()) {
                destroyPageStructure()
              }
            },
            clearMeasurementFlags,
            removeCommandListeners,
            removePageTransform,
            removeRootTransform,
            removePageContentTransform,
            removeMutationListeners,
          )
        })
      })
    }),
})
