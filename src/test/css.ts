/**
 * Reads the px length out of a serialized CSS value.
 *
 * jsdom rounds numbers inside CSS functions (`min(100%, 793.701px)`), so tests
 * compare the parsed length instead of the exact string.
 */
export function cssPx(value: string) {
  const match = /([\d.]+)px\)?$/.exec(value)
  if (!match) throw new Error(`No px length in "${value}"`)
  return Number(match[1])
}
