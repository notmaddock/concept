import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import type {
  DOMConversionMap,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical'
import type { ReactElement } from 'react'
import {
  validateImageDisplayWidth,
  validateImageSource,
} from '@/lib/documents/image-schema'
import type { ImageSource } from '@/lib/documents/image-schema'
import { ImageBlock } from './ImageBlock'

export type SerializedImageNode = Spread<
  {
    type: 'image'
    version: 1
    source: ImageSource
    altText: string
    displayWidth: number | null
  },
  SerializedLexicalNode
>

export class ImageNode extends DecoratorNode<ReactElement> {
  __imageVersion = 1
  __source: ImageSource
  __altText: string
  __displayWidth: number | null

  static getType() {
    return 'image'
  }
  static clone(node: ImageNode) {
    const clone = new ImageNode(
      node.__source,
      node.__altText,
      node.__displayWidth,
      node.__key,
    )
    clone.__imageVersion = node.__imageVersion
    return clone
  }

  constructor(
    source?: ImageSource,
    altText = '',
    displayWidth: number | null = null,
    key?: NodeKey,
  ) {
    super(key)
    // Lexical/Yjs constructs an empty instance to discover synchronized fields.
    this.__source =
      source === undefined
        ? (undefined as unknown as ImageSource)
        : validateImageSource(source)
    this.__altText = altText
    this.__displayWidth = validateImageDisplayWidth(displayWidth)
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    if (
      Number(serialized.version) !== 1 ||
      typeof serialized.altText !== 'string'
    )
      throw new Error('Unsupported or invalid image node')
    return $createImageNode(
      validateImageSource(serialized.source),
      serialized.altText,
      validateImageDisplayWidth(serialized.displayWidth),
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
  getDisplayWidth() {
    return this.getLatest().__displayWidth
  }
  setSource(source: ImageSource): this {
    this.getWritable().__source = validateImageSource(source)
    return this
  }
  setAltText(altText: string): this {
    this.getWritable().__altText = altText
    return this
  }
  setDisplayWidth(width: number | null): this {
    this.getWritable().__displayWidth = validateImageDisplayWidth(width)
    return this
  }
  getTextContent() {
    const alt = this.getAltText()
    return alt ? `[Image: ${alt}]` : '[Image]'
  }
  isInline() {
    return false
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
      />
    )
  }
}

export function $createImageNode(
  source: ImageSource,
  altText = '',
  displayWidth: number | null = null,
): ImageNode {
  return $applyNodeReplacement(new ImageNode(source, altText, displayWidth))
}
export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode
}
