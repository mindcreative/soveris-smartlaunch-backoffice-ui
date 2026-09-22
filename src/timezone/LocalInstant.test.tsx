import { describe, expect, it } from 'vitest'
import { localInstantLabel, normalizeLocalWallInput, parseLocalInstant } from './LocalInstant'

describe('plain local date-time values', () => {
  it('validates and displays a local timestamp without a browser timezone', () => {
    expect(normalizeLocalWallInput('2026-09-22T16:38')).toBe('2026-09-22T16:38:00.000000')
    expect(localInstantLabel('2026-09-22T16:38:09.117474')).toBe('2026-09-22 16:38:09.117474')
  })
  it.each(['2026-02-30T01:00:00.000000', '2026-09-22T16:38:09Z',
    '2026-09-22T16:38:09.000000+02:00', { localDateTime: '2026-09-22T16:38:09.000000' }])(
    'rejects non-wall data %#', (value) => expect(() => parseLocalInstant(value)).toThrow())
})
