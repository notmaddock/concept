import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  RichTextExtension,
} from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  defineExtension,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { serializeExport } from '#/lib/documents/export'
import { convertHtml } from '#/lib/documents/import/html'
import { DocumentOutlinePlugin } from './DocumentOutlinePlugin'
import {
  $createTableOfContentsNode,
  $isTableOfContentsNode,
  TableOfContentsNode,
} from './TableOfContentsNode'
import { $decorateOutlineHeading, $readOutline } from './outline'
import {
  INSERT_TABLE_OF_CONTENTS_COMMAND,
  TableOfContentsExtension,
} from './table-of-contents-extension'

const testExtension = defineExtension({
  name: 'test-outline',
  dependencies: [RichTextExtension, TableOfContentsExtension],
  nodes: [TableOfContentsNode],
  init(config) {
    config.dom = {
      ...config.dom,
      $decorateDOM: (node, _previous, dom) =>
        $decorateOutlineHeading(node, dom),
    }
  },
})

function EditorRef({
  setEditor,
}: {
  setEditor: (editor: LexicalEditor) => void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    setEditor(editor)
  }, [editor, setEditor])
  return null
}

function appendHeadings() {
  $getRoot().append(
    $createHeadingNode('h2').append($createTextNode('Shared heading')),
    $createHeadingNode('h5').append($createTextNode('Nested [entry]')),
    $createHeadingNode('h3').append($createTextNode('   ')),
    $createHeadingNode('h2').append($createTextNode('Shared heading')),
  )
}

describe('document outline and table of contents', () => {
  it('updates both navigation views as headings change and navigates in view-only mode', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const sidebar = document.createElement('aside')
    document.body.append(host, sidebar)
    const root = createRoot(host)
    let editor!: LexicalEditor
    try {
      await act(async () => {
        root.render(
          <LexicalExtensionComposer
            extension={testExtension}
            contentEditable={<ContentEditable />}
          >
            <EditorRef setEditor={(value) => (editor = value)} />
            <DocumentOutlinePlugin container={sidebar} />
          </LexicalExtensionComposer>,
        )
      })
      expect(sidebar.textContent).toContain(
        'Add headings to build the outline.',
      )
      await act(async () =>
        editor.update(
          () => {
            const paragraph = $createParagraphNode()
            $getRoot().clear().append(paragraph)
            paragraph.selectStart()
            expect(
              editor.dispatchCommand(
                INSERT_TABLE_OF_CONTENTS_COMMAND,
                undefined,
              ),
            ).toBe(true)
          },
          { discrete: true },
        ),
      )
      expect(host.textContent).toContain(
        'Add headings to build the table of contents.',
      )
      await act(async () => editor.update(appendHeadings, { discrete: true }))
      const block = host.querySelector('nav')!
      expect(block.querySelectorAll('li > ul a')).toHaveLength(1)
      expect(sidebar.querySelectorAll('a')).toHaveLength(3)
      const duplicateLinks = [...sidebar.querySelectorAll('a')].filter(
        (anchor) => anchor.textContent === 'Shared heading',
      )
      expect(duplicateLinks.map((anchor) => anchor.hash)).toEqual([
        `#${host.querySelectorAll('h2')[0].id}`,
        `#${host.querySelectorAll('h2')[1].id}`,
      ])

      await act(async () => {
        editor.update(
          () => {
            const [first, nested, blank, last] = $getRoot()
              .getChildren()
              .filter($isHeadingNode)
            nested.clear().append($createTextNode('Renamed'))
            first.insertBefore(last)
            first.remove()
            blank.remove()
          },
          { discrete: true },
        )
        editor.setEditable(false)
      })
      expect(block.querySelector('button')).toBeNull()
      expect(
        editor.dispatchCommand(INSERT_TABLE_OF_CONTENTS_COMMAND, undefined),
      ).toBe(false)
      const heading = host.querySelector('h5')!
      const scroll = vi.fn()
      heading.scrollIntoView = scroll
      const anchor = sidebar.querySelector<HTMLElement>(
        `a[href="#${heading.id}"]`,
      )!
      expect(anchor.textContent).toBe('Renamed')
      expect(block.querySelector('ul ul a')?.textContent).toBe('Renamed')
      await act(async () => anchor.click())
      expect(document.activeElement).toBe(heading)
      expect(scroll).toHaveBeenCalledWith({ block: 'start', inline: 'nearest' })

      await act(async () => editor.setEditable(true))
      await act(async () => block.querySelector('button')!.click())
      expect(host.querySelector('nav')).toBeNull()
      expect(sidebar.querySelectorAll('a')).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      sidebar.remove()
    }
  })

  it('preserves a native block through JSON and HTML, and exports a hierarchical snapshot', async () => {
    const editor = createEditor({ nodes: [HeadingNode, TableOfContentsNode] })
    editor.update(
      () => {
        $getRoot().append($createTableOfContentsNode())
        appendHeadings()
      },
      { discrete: true },
    )
    const state = editor.parseEditorState(
      JSON.stringify(editor.getEditorState()),
    )
    expect(
      state.read(() => $isTableOfContentsNode($getRoot().getFirstChild())),
    ).toBe(true)

    const { content: html } = await serializeExport(editor, 'Outline', 'html')
    const output = new DOMParser().parseFromString(html, 'text/html')
    const links = [...output.querySelectorAll('nav a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#concept-heading-1',
      '#concept-heading-2',
      '#concept-heading-3',
    ])
    expect(
      links.map(
        (link) => output.querySelector(link.getAttribute('href')!)?.textContent,
      ),
    ).toEqual(['Shared heading', 'Nested [entry]', 'Shared heading'])

    const { content: markdown } = await serializeExport(
      editor,
      'Outline',
      'markdown',
    )
    expect(markdown).toContain(
      '**Table of contents**\n\n- Shared heading\n  - Nested \\[entry\\]\n- Shared heading',
    )
    const restored = createEditor({ nodes: [HeadingNode, TableOfContentsNode] })
    restored.update(() => convertHtml(html, restored), { discrete: true })
    restored.getEditorState().read(() => {
      expect(
        $getRoot().getChildren().filter($isTableOfContentsNode),
      ).toHaveLength(1)
      expect($readOutline().map(({ text }) => text)).toEqual([
        'Shared heading',
        'Nested [entry]',
        'Shared heading',
      ])
      expect($getRoot().getTextContent()).not.toContain('Table of contents')
    })
  })
})
