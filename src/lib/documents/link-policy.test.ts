import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from 'lexical'
import { $createLinkNode, LinkNode } from '@lexical/link'
import {
  $applyLinkPolicy,
  isExternalLink,
  linkAttributes,
  normalizeLinkUrl,
} from './link-policy'

describe('link policy', () => {
  it('accepts only http, https, mailto, and tel URLs', () => {
    expect(normalizeLinkUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com')
    expect(normalizeLinkUrl('mailto:user@example.com')).toBe(
      'mailto:user@example.com',
    )
    expect(normalizeLinkUrl('tel:+15551234')).toBe('tel:+15551234')
    expect(normalizeLinkUrl('tel:+1 555 1234')).toBe('tel:+15551234')
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('data:text/html,<script>')).toBeNull()
    expect(normalizeLinkUrl('not a url')).toBeNull()
    expect(normalizeLinkUrl('   ')).toBeNull()
  })

  it('marks only web links as external', () => {
    expect(isExternalLink('https://example.com')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('mailto:user@example.com')).toBe(false)
    expect(isExternalLink('tel:+15551234')).toBe(false)
    expect(linkAttributes('https://example.com')).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    })
    expect(linkAttributes('mailto:user@example.com')).toEqual({})
  })

  it('applies external attributes to existing links', () => {
    const editor = createEditor({
      namespace: 'link-policy-test',
      nodes: [LinkNode],
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createLinkNode('https://example.com').append(
              $createTextNode('Example'),
            ),
          ),
        )
        $applyLinkPolicy()
      },
      { discrete: true },
    )
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getChildren()[0]
      if (!$isElementNode(paragraph)) throw new Error('Missing paragraph')
      const link = paragraph.getFirstChild()
      expect(link).toBeInstanceOf(LinkNode)
      expect((link as LinkNode).getTarget()).toBe('_blank')
      expect((link as LinkNode).getRel()).toBe('noopener noreferrer nofollow')
    })
  })
})
