import { isNotFound } from '@tanstack/react-router'
import { expect, it } from 'vitest'
import { Route } from './$id'

it('accepts valid UUID parameters and throws notFound() for malformed document IDs', () => {
  const parse = Route.options.params?.parse
  expect(parse).toBeTypeOf('function')

  const validId = '0aad2d15-507a-43ca-8a04-e194484002a3'
  expect(parse!({ id: validId })).toEqual({ id: validId })

  let thrown: unknown
  try {
    parse!({ id: 'not-a-valid-uuid' })
  } catch (error) {
    thrown = error
  }
  expect(isNotFound(thrown)).toBe(true)
})
