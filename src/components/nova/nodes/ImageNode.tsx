import { $applyNodeReplacement } from 'lexical'
import type {
  DOMConversionMap,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  Spread,
} from 'lexical'
import type { ReactElement } from 'react'
import {
  validateImageDisplayWidth,
  validateImageSource,
} from '@/lib/documents/image-schema'
import type { ImageSource } from '@/lib/documents/image-schema'
import { ImageBlock } from './ImageBlock'
import { ResizableNode, validateNodeAlignment } from './ResizableNode'
import type { NodeAlignment, SerializedResizableNode } from './ResizableNode'

export type SerializedImageNode = Spread<
  {
    type: 'image'
    version: 1
    source: ImageSource
    altText: string
    displayWidth: number | null
  },
  SerializedResizableNode
>

export class ImageNode extends ResizableNode<ReactElement> {
  __imageVersion = 1
  __source: ImageSource
  __altText: string

  static getType() {
    return 'image'
  }
  static clone(node: ImageNode) {
    const clone = new ImageNode(
      node.__source,
      node.__altText,
      node.__displayWidth,
      node.__key,
      node.__alignment,
    )
    clone.__imageVersion = node.__imageVersion
    return clone
  }

  constructor(
    source?: ImageSource,
    altText = '',
    displayWidth: number | null = null,
    key?: NodeKey,
    alignment: NodeAlignment = 'left',
  ) {
    super(displayWidth, key, alignment)
    // Lexical/Yjs constructs an empty instance to discover synchronized fields.
    this.__source =
      source === undefined
        ? (undefined as unknown as ImageSource)
        : validateImageSource(source)
    this.__altText = altText
  }

  static importJSON(
    serialized: Spread<{ alignment?: NodeAlignment }, SerializedImageNode>,
  ): ImageNode {
    if (
      Number(serialized.version) !== 1 ||
      typeof serialized.altText !== 'string'
    )
      throw new Error('Unsupported or invalid image node')
    return $createImageNode(
      validateImageSource(serialized.source),
      serialized.altText,
      validateImageDisplayWidth(serialized.displayWidth),
      serialized.alignment === undefined
        ? 'left'
        : validateNodeAlignment(serialized.alignment),
    )
  }

  exportJSON(): SerializedImageNode {
    if (this.getLatest().__imageVersion !== 1)
      throw new Error('Unsupported image node version')
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      source: validateImageSource(this.getSource()),
      altText: this.getAltText(),
      displayWidth: this.getDisplayWidth(),
    }
  }

  getSource() {
    return this.getLatest().__source
  }
  getAssetId() {
    return this.getSource().assetId
  }
  getAltText() {
    return this.getLatest().__altText
  }
  setSource(source: ImageSource): this {
    this.getWritable().__source = validateImageSource(source)
    return this
  }
  setAltText(altText: string): this {
    this.getWritable().__altText = altText
    return this
  }
  protected validateDisplayWidth(width: number | null): number | null {
    return validateImageDisplayWidth(width)
  }
  getTextContent() {
    const alt = this.getAltText()
    return alt ? `[Image: ${alt}]` : '[Image]'
  }
  createDOM() {
    const element = document.createElement('div')
    element.className = 'nova-image-block'
    return element
  }
  updateDOM() {
    return false
  }
  static importDOM(): DOMConversionMap {
    return {
      img: (element) => {
        const encoded = element.getAttribute('data-concept-image-source')
        if (!encoded) return null
        try {
          const source = validateImageSource(JSON.parse(encoded))
          const alignment = validateNodeAlignment(
            element.getAttribute('data-concept-alignment') ?? 'left',
          )
          const width = element.getAttribute('width')
          const displayWidth =
            width === null ? null : validateImageDisplayWidth(Number(width))
          return {
            priority: 4,
            conversion: () => ({
              node: $createImageNode(
                source,
                element.getAttribute('alt') ?? '',
                displayWidth,
                alignment,
              ),
            }),
          }
        } catch {
          return null
        }
      },
    }
  }
  exportDOM(): DOMExportOutput {
    const element = document.createElement('img')
    element.alt = this.getAltText()
    element.dataset.conceptAlignment = this.getAlignment()
    element.style.display = 'block'
    element.style.marginLeft = this.getAlignment() === 'left' ? '0' : 'auto'
    element.style.marginRight = this.getAlignment() === 'right' ? '0' : 'auto'
    element.dataset.conceptImageAssetId = this.getAssetId()
    element.dataset.conceptImageSource = JSON.stringify(this.getSource())
    const width = this.getDisplayWidth()
    if (width !== null) element.width = width
    return { element }
  }
  decorate(): ReactElement {
    return (
      <ImageBlock
        nodeKey={this.getKey()}
        source={this.getSource()}
        altText={this.getAltText()}
        displayWidth={this.getDisplayWidth()}
        alignment={this.getAlignment()}
      />
    )
  }
}

export function $createImageNode(
  source: ImageSource,
  altText = '',
  displayWidth: number | null = null,
  alignment: NodeAlignment = 'left',
): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(source, altText, displayWidth, undefined, alignment),
  )
}
export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode
}
