import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { HorizontalRuleNode } from '@lexical/extension'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import type { Klass, LexicalNode } from 'lexical'
import { ImageNode } from './nodes/ImageNode'
import { PageBreakNode } from './pages/PageBreakNode'
import { PageContentNode } from './pages/PageContentNode'
import { PageNode } from './pages/PageNode'

export const documentNodes: Array<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  HorizontalRuleNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  ImageNode,
  PageNode,
  PageContentNode,
  PageBreakNode,
]
