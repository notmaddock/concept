/**
 * Prism token names shared by the editor theme and standalone HTML export.
 *
 * The editor styles these through `token <name>` classes in `nova.css`; the
 * export inlines the same groups as a `<style>` block because its CSP forbids
 * external stylesheets. Keep both sides on this registry so a token cannot
 * render in the editor and disappear from an exported document.
 */
export const syntaxTokenGroups = [
  {
    tokens: ['atrule', 'boolean', 'constant', 'keyword'],
    color: '#9333ea',
  },
  {
    tokens: ['attr', 'number', 'symbol', 'variable'],
    color: '#b45309',
  },
  {
    tokens: ['character', 'inserted', 'selector', 'string'],
    color: '#047857',
  },
  {
    tokens: ['deleted', 'important', 'tag'],
    color: '#dc2626',
  },
  {
    tokens: ['function', 'property', 'url'],
    color: '#1d4ed8',
  },
  {
    tokens: ['comment', 'operator'],
    color: '#7d6b56',
  },
] as const

export const codeHighlightTheme = Object.fromEntries(
  syntaxTokenGroups.flatMap(({ tokens }) =>
    tokens.map((token) => [token, `token ${token}`]),
  ),
) as Record<string, string>

export function syntaxHighlightCss() {
  return [
    ...syntaxTokenGroups.map(
      ({ tokens, color }) =>
        `${tokens.map((token) => `.token.${token}`).join(', ')} { color: ${color}; }`,
    ),
    '.token.comment { font-style: italic; }',
    '.token.important { font-weight: 600; }',
    '.token.url { text-decoration: underline; }',
  ].join('\n')
}
