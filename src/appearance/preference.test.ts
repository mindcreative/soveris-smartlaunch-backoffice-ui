import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePreference, readPreference, resolveMode, savePreference } from './preference'

describe('browser appearance preference', () => {
  beforeEach(() => localStorage.clear())
  it.each([null, '', 'DARK', 'invalid', '<script>'])('defaults invalid %s to System', value => {
    expect(normalizePreference(value)).toBe('system')
  })
  it.each(['system', 'light', 'dark'] as const)('round trips %s', value => {
    expect(savePreference('account-a', value)).toBe(true)
    expect(readPreference('account-a')).toBe(value)
  })
  it('guards inaccessible storage and failed persistence', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota') })
    expect(readPreference('account-a')).toBe('system')
    expect(savePreference('account-a', 'dark')).toBe(false)
  })
  it('resolves System and explicit overrides', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })
})
