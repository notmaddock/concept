const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function countDocumentText(text: string) {
  let words = 0
  for (const part of wordSegmenter.segment(text)) {
    if (part.isWordLike) words++
  }

  let characters = 0
  let charactersWithoutSpaces = 0
  for (const character of text) {
    characters++
    if (!/\s/u.test(character)) charactersWithoutSpaces++
  }

  return { words, characters, charactersWithoutSpaces }
}
