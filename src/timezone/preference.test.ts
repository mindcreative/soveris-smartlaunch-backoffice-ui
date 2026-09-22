import { describe, expect, it } from 'vitest'
import { timeZoneOptions } from './preference'

describe('create-user timezone choices', () => {
  it('contains UTC and no fixed-offset substitute', () => {
    expect(timeZoneOptions()).toContain('UTC')
    expect(timeZoneOptions()).not.toContain('UTC+2')
  })
})
