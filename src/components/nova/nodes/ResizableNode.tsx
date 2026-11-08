import { DecoratorNode } from 'lexical'
import type { NodeKey, SerializedLexicalNode, Spread } from 'lexical'

export type NodeAlignment = 'left' | 'center' | 'right'

export type SerializedResizableNode = Spread<
  { displayWidth: number | null; alignment: NodeAlignment },
  SerializedLexicalNode
>

export function validateNodeAlignment(value: unknown): NodeAlignment {
  if (value !== 'left' && value !== 'center' && value !== 'right')
    throw new Error('Invalid node alignment')
  return value
}

export abstract class ResizableNode<T> extends DecoratorNode<T> {
  __displayWidth: number | null
  __alignment: NodeAlignment

  constructor(
    displayWidth: number | null = null,
    key?: NodeKey,
    alignment: NodeAlignment = 'left',
  ) {
    super(key)
    this.__displayWidth = this.validateDisplayWidth(displayWidth)
    this.__alignment = validateNodeAlignment(alignment)
  }

  afterCloneFrom(node: this): void {
    super.afterCloneFrom(node)
    this.__displayWidth = node.__displayWidth
    this.__alignment = node.__alignment
  }

  protected validateDisplayWidth(width: number | null): number | null {
    if (width === null) return null
    if (typeof width !== 'number' || !Number.isFinite(width))
      throw new Error('Invalid display width')
    return Math.max(1, width)
  }

  getDisplayWidth(): number | null {
    return this.getLatest().__displayWidth
  }

  setDisplayWidth(width: number | null): this {
    this.getWritable().__displayWidth = this.validateDisplayWidth(width)
    return this
  }

  getAlignment(): NodeAlignment {
    return this.getLatest().__alignment
  }

  setAlignment(alignment: NodeAlignment): this {
    this.getWritable().__alignment = validateNodeAlignment(alignment)
    return this
  }

  exportJSON(): SerializedResizableNode {
    return {
      ...super.exportJSON(),
      displayWidth: this.getDisplayWidth(),
      alignment: this.getAlignment(),
    }
  }

  isInline(): boolean {
    return false
  }
}
