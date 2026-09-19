import { defineExtension } from '@lexical/extension'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { ScrollMarginPlugin } from './ScrollMarginPlugin'

/**
 * ScrollMarginExtension provides scroll headroom when navigating or typing near
 * the boundaries of the scroll container, preventing text from being obscured
 * by scroll-fade masks or glued to the bottom border.
 */
export const ScrollMarginExtension = defineExtension({
  name: 'ScrollMarginExtension',
  dependencies: [[ReactExtension, { decorators: [ScrollMarginPlugin] }]],
})
