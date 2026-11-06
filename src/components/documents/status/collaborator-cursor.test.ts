import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findCollaboratorCaret,
  revealCollaboratorCaret,
} from './collaborator-cursor'

const originalMatchMedia: typeof window.matchMedia | undefined =
  window.matchMedia

function createCaret(name: string, color: string) {
  const caret = document.createElement('span')
  caret.style.position = 'absolute'
  caret.style.zIndex = '10'
  caret.style.backgroundColor = color

  const label = document.createElement('span')
  label.textContent = name
  caret.append(label)

  return caret
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function restoreMatchMedia(matchMedia: typeof window.matchMedia | undefined) {
  if (matchMedia) {
    window.matchMedia = matchMedia
  } else {
    Reflect.deleteProperty(window, 'matchMedia')
  }
}

afterEach(() => {
  document.body.replaceChildren()
  restoreMatchMedia(originalMatchMedia)
})

describe('findCollaboratorCaret', () => {
  it('matches a caret by trimmed collaborator name', () => {
    const container = document.createElement('div')
    const caret = createCaret(' Ada Lovelace ', '#ff0000')
    container.append(createCaret('Grace Hopper', '#0000ff'), caret)
    document.body.append(container)

    expect(findCollaboratorCaret(container, { name: '  Ada Lovelace  ' })).toBe(
      caret,
    )
  })

  it('disambiguates duplicate names by normalized color and falls back to the first match', () => {
    const container = document.createElement('div')
    const redCaret = createCaret('Ada', '#ff0000')
    const blueCaret = createCaret('Ada', 'rgb(0, 0, 255)')
    container.append(redCaret, blueCaret)
    document.body.append(container)

    expect(
      findCollaboratorCaret(container, {
        name: 'Ada',
        color: 'rgb(255, 0, 0)',
      }),
    ).toBe(redCaret)
    expect(
      findCollaboratorCaret(container, { name: 'Ada', color: '#0000ff' }),
    ).toBe(blueCaret)
    expect(
      findCollaboratorCaret(container, { name: 'Ada', color: '#123456' }),
    ).toBe(redCaret)
  })

  it('finds carets nested inside legacy selection spans', () => {
    const container = document.createElement('div')
    const legacySelection = document.createElement('span')
    legacySelection.style.position = 'absolute'
    legacySelection.style.zIndex = '5'
    legacySelection.append(document.createElement('span'))

    const caret = createCaret('Ada', '#ff0000')
    legacySelection.append(caret)
    container.append(legacySelection)
    document.body.append(container)

    expect(findCollaboratorCaret(container, { name: 'Ada' })).toBe(caret)
  })

  it('returns null without a container, a usable name, or a match', () => {
    const container = document.createElement('div')
    container.append(createCaret('Ada', '#ff0000'))
    document.body.append(container)

    expect(findCollaboratorCaret(null, { name: 'Ada' })).toBeNull()
    expect(findCollaboratorCaret(container, {})).toBeNull()
    expect(findCollaboratorCaret(container, { name: '   ' })).toBeNull()
    expect(findCollaboratorCaret(container, { name: 'Missing' })).toBeNull()
  })
})

describe('revealCollaboratorCaret', () => {
  it('falls back to scrollIntoView without a main ancestor', () => {
    setReducedMotion(false)
    const caret = createCaret('Ada', '#ff0000')
    const scrollIntoView = vi.fn()
    caret.scrollIntoView = scrollIntoView
    document.body.append(caret)

    revealCollaboratorCaret(caret)

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('uses instant scrolling when reduced motion is preferred', () => {
    setReducedMotion(true)
    const caret = createCaret('Ada', '#ff0000')
    const scrollIntoView = vi.fn()
    caret.scrollIntoView = scrollIntoView
    document.body.append(caret)

    revealCollaboratorCaret(caret)

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('scrolls the nearest main container to center the caret', () => {
    setReducedMotion(false)
    const main = document.createElement('main')
    const caret = createCaret('Ada', '#ff0000')
    const scrollTo = vi.fn()

    main.scrollTop = 120
    Object.defineProperty(main, 'clientHeight', {
      configurable: true,
      value: 400,
    })
    main.getBoundingClientRect = vi.fn(() => ({
      top: 50,
      left: 0,
      right: 0,
      bottom: 50,
      width: 0,
      height: 0,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    }))
    caret.getBoundingClientRect = vi.fn(() => ({
      top: 350,
      left: 0,
      right: 0,
      bottom: 370,
      width: 0,
      height: 20,
      x: 0,
      y: 350,
      toJSON: () => ({}),
    }))
    main.scrollTo = scrollTo
    main.append(caret)
    document.body.append(main)

    revealCollaboratorCaret(caret)

    expect(scrollTo).toHaveBeenCalledWith({
      top: 120 + 350 - 50 - (400 - 20) / 2,
      behavior: 'smooth',
    })
  })
})
