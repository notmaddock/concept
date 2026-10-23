import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs'
import { applyUpdate, Doc, encodeStateAsUpdate, XmlText } from 'yjs'
import { LocalProvider } from './local-provider'
import {
  $getPageSetup,
  $setPageSetup,
  DEFAULT_PAGE_SETUP,
  PAGE_SIZES,
  pageDimensions,
  pageSetupError,
  pageSetupState,
} from './page-setup'

describe('page setup', () => {
  it('defaults to pageless and validates paper geometry', () => {
    expect(pageSetupState.parse(null).mode).toBe('pageless')
    expect(
      pageDimensions({ ...DEFAULT_PAGE_SETUP, orientation: 'landscape' }),
    ).toEqual({ width: 297, height: 210 })
    expect(
      pageSetupError({
        ...DEFAULT_PAGE_SETUP,
        mode: 'paper',
        margins: { top: 200, bottom: 200, left: 0, right: 0 },
      }),
    ).toBeTruthy()
    expect(
      pageSetupState.parse({ mode: 'paper', width: Infinity, size: 'custom' }),
    ).toEqual(DEFAULT_PAGE_SETUP)
  })
  it('stores root settings in Yjs updates and restores serialized settings', () => {
    const doc = new Doc()
    const editor = createEditor({
      namespace: 'page-setup-test',
      onError: (error) => {
        throw error
      },
    })
    const provider = new LocalProvider('test', doc, {
      whenSynced: Promise.resolve(),
      destroy: async () => {},
    })
    const binding = createYjsBinding({
      editor,
      id: 'test',
      doc,
      docMap: new Map([['test', doc]]),
    })
    const unregister = editor.registerUpdateListener(
      ({
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      }) =>
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        ),
    )
    const setup = {
      ...DEFAULT_PAGE_SETUP,
      mode: 'paper' as const,
      size: 'Legal' as const,
    }
    editor.update(
      () => {
        $getRoot().append($createParagraphNode())
        $setPageSetup(setup)
      },
      { discrete: true },
    )
    const restored = new Doc()
    applyUpdate(restored, encodeStateAsUpdate(doc))
    expect(
      JSON.stringify(restored.get('root', XmlText).getAttributes()),
    ).toEqual(JSON.stringify(doc.get('root', XmlText).getAttributes()))
    expect(
      JSON.stringify(restored.get('root', XmlText).getAttributes()),
    ).toContain('Legal')
    const nextEditor = createEditor({
      namespace: 'restore',
      onError: (error) => {
        throw error
      },
    })
    nextEditor.setEditorState(
      nextEditor.parseEditorState(editor.getEditorState().toJSON()),
    )
    expect(nextEditor.getEditorState().read($getPageSetup)).toEqual(setup)
    unregister()
    provider.destroy()
    doc.destroy()
    restored.destroy()
  })
})

it.each(Object.keys(PAGE_SIZES) as Array<keyof typeof PAGE_SIZES>)(
  'validates every margin preset for %s in both orientations',
  (size) => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const margin of [12.7, 25.4, 38.1, 50.8]) {
        const setup = {
          ...DEFAULT_PAGE_SETUP,
          mode: 'paper' as const,
          size,
          orientation,
          margins: { top: margin, right: margin, bottom: margin, left: margin },
        }
        expect(pageSetupError(setup) === null).toBe(
          !(size === 'A6' && margin === 50.8),
        )
        if (!pageSetupError(setup))
          expect(pageSetupState.parse(setup)).toEqual(setup)
        const [width, height] = PAGE_SIZES[size]
        expect(pageDimensions(setup)).toEqual(
          orientation === 'portrait'
            ? { width, height }
            : { width: height, height: width },
        )
      }
    }
  },
)
