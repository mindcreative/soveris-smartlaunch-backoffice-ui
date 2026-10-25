import { describe, expect, it } from 'vitest'
import { accountEmail, newPasswordError } from './credentials'

describe('account credentials usability boundaries', () => {
  it('preserves account dots/tags, trims only ASCII boundary whitespace and folds ASCII case', () => {
    expect(accountEmail(' \tA.B+Tag@EXAMPLE.TEST\r\n')).toBe('a.b+tag@example.test')
    expect(accountEmail('\u00a0test@example.test')).toBeNull()
    expect(accountEmail('a'.repeat(64) + '@example.test')).not.toBeNull()
    expect(accountEmail('a'.repeat(65) + '@example.test')).toBeNull()
    expect(accountEmail('a..b@example.test')).toBeNull()
    expect(accountEmail('a@127.0.0.1')).toBeNull()
    expect(accountEmail('a@xn--bcher-kva.test')).not.toBeNull()
    expect(accountEmail('a@xn--.test')).toBeNull()
    expect(accountEmail('a@one.999')).toBe('a@one.999')
    expect(accountEmail('a@xn--bcher-kva.999')).toBe('a@xn--bcher-kva.999')
    expect(accountEmail('a@127.1')).toBeNull()
  })

  it('counts Unicode scalars without normalizing, truncating or adding composition rules', () => {
    expect(newPasswordError('a'.repeat(14))).not.toBeNull()
    expect(newPasswordError('a'.repeat(15))).toBeNull()
    expect(newPasswordError('😀'.repeat(128))).toBeNull()
    expect(newPasswordError('😀'.repeat(129))).not.toBeNull()
    expect(newPasswordError(' '.repeat(15))).not.toBeNull()
    expect(newPasswordError('a'.repeat(15) + '\u0000')).not.toBeNull()
    expect(newPasswordError('a'.repeat(15) + '\ud800')).not.toBeNull()
    expect(newPasswordError(' exact spaces stay ')).toBeNull()
  })

  it('rejects non-ASCII email before any case folding can turn it into a different ASCII identity', () => {
    expect(accountEmail('K@example.test')).toBeNull()
    expect(accountEmail('User@ÉXAMPLE.test')).toBeNull()
  })
})
