import { marked } from 'marked'
import type { Token, Tokens } from 'marked'
import type { ChangelogEntry, ChangelogInline } from '../src/lib/changelog.ts'

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | undefined

  for (const token of marked.lexer(markdown)) {
    if (token.type === 'heading' && token.depth === 2) {
      const parsed = parseVersionHeading(token as Tokens.Heading)
      if (!parsed) continue
      current = { ...parsed, sections: [] }
      entries.push(current)
      continue
    }

    if (token.type === 'heading' && token.depth === 3 && current) {
      current.sections.push({ title: token.text, items: [] })
      continue
    }

    if (token.type === 'list' && current) {
      const section = current.sections.at(-1)
      if (!section) continue
      for (const item of token.items) {
        section.items.push(inlineFromBlockTokens(item.tokens))
      }
    }
  }

  return entries
}

function parseVersionHeading(
  token: Tokens.Heading,
): { version: string; date: string } | null {
  const version = token.text.match(
    /\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*)\]?/,
  )?.[1]
  if (!version) return null

  const date = token.text.match(/\(([^)]+)\)\s*$/)?.[1] ?? ''
  return { version, date }
}

function inlineFromBlockTokens(tokens: Token[]): ChangelogInline[] {
  const nodes: ChangelogInline[] = []

  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'paragraph') {
      const inlineTokens = token.tokens
      if (inlineTokens?.length) nodes.push(...inlineFromTokens(inlineTokens))
      else nodes.push({ type: 'text', value: token.text })
      continue
    }

    if (token.type === 'list') {
      for (const item of token.items) {
        nodes.push(...inlineFromBlockTokens(item.tokens))
      }
    }
  }

  return nodes
}

function inlineFromTokens(tokens: Token[]): ChangelogInline[] {
  const nodes: ChangelogInline[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const inlineTokens = token.tokens
        if (inlineTokens?.length) nodes.push(...inlineFromTokens(inlineTokens))
        else nodes.push({ type: 'text', value: token.text })
        break
      }
      case 'escape':
        nodes.push({ type: 'text', value: token.text })
        break
      case 'strong':
        nodes.push({
          type: 'strong',
          children: token.tokens
            ? inlineFromTokens(token.tokens)
            : [{ type: 'text', value: token.text }],
        })
        break
      case 'em':
        nodes.push({
          type: 'emphasis',
          children: token.tokens
            ? inlineFromTokens(token.tokens)
            : [{ type: 'text', value: token.text }],
        })
        break
      case 'codespan':
        nodes.push({ type: 'code', value: token.text })
        break
      case 'link':
        nodes.push({
          type: 'link',
          href: token.href,
          children: token.tokens
            ? inlineFromTokens(token.tokens)
            : [{ type: 'text', value: token.text }],
        })
        break
      case 'br':
        nodes.push({ type: 'text', value: '\n' })
        break
      case 'html':
        nodes.push({ type: 'text', value: token.text })
        break
      default:
        break
    }
  }

  return nodes
}
