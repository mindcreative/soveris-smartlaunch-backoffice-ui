import { describe, expect, it, vi } from 'vitest'
import { createUuidV7 } from './uuidV7'

describe('createUuidV7', () => {
  it('encodes the Unix millisecond timestamp, RFC version and variant', () => {
    const timestamp = 0x0123456789ab
    const uuid = createUuidV7({
      now: () => timestamp,
      fillRandom: (target) => target.fill(0xff),
    })

    expect(uuid).toBe('01234567-89ab-7fff-bfff-ffffffffffff')
    expect(uuid[14]).toBe('7')
    expect(uuid[19]).toMatch(/[89ab]/)
  })

  it('uses fresh cryptographic randomness for each confirmed operation', () => {
    let seed = 0
    const fillRandom = vi.fn((target: Uint8Array) => {
      target.fill(seed)
      seed += 1
    })
    const options = { now: () => 1_725_190_400_000, fillRandom }

    const first = createUuidV7(options)
    const second = createUuidV7(options)

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(fillRandom).toHaveBeenCalledTimes(2)
  })

  it.each([-1, 2 ** 48, Number.NaN, 1.5])('rejects an invalid timestamp %s', (timestamp) => {
    expect(() => createUuidV7({
      now: () => timestamp,
      fillRandom: (target) => target.fill(0),
    })).toThrow('timestamp')
  })
})
