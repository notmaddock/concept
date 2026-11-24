import { expect, it } from 'vitest'
import { countDocumentText } from './text-statistics'

it('counts Unicode words and code points with and without whitespace', () => {
  expect(countDocumentText('déjà\tvu\n猫 🐈')).toEqual({
    words: 3,
    characters: 11,
    charactersWithoutSpaces: 8,
  })
  expect(countDocumentText('')).toEqual({
    words: 0,
    characters: 0,
    charactersWithoutSpaces: 0,
  })
})
