import { describe, expect, it } from 'vitest'
import { canonicalizeGuid } from './guid'

describe('canonicalizeGuid', () => {
  it('returns a lowercase canonical GUID', () => {
    expect(canonicalizeGuid('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBe(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    )
  })

  it.each([
    undefined,
    '',
    'not-a-guid',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee',
    'gggggggg-bbbb-cccc-dddd-eeeeeeeeeeee',
  ])('rejects an invalid route Client value: %s', (value) => {
    expect(canonicalizeGuid(value)).toBeNull()
  })
})
