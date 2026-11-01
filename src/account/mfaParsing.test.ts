import { describe, expect, it } from 'vitest'
import { normalizeMfaError } from './mfaError'
import { parseMfaCodes, parseMfaEnrollment, parseMfaRequired, parseMfaSession } from './mfaParsing'
import { currentAuthorityFixture } from '../test/authorityFixtures'

const proof = 'A'.repeat(43)
const id = '01990000-0000-7000-8000-000000000009'
const expiresAt = new Date(Date.now() + 240_000).toISOString()
const pending = { status: 'mfa_required', challenge: { id, secret: proof, purpose: 'login', expiresAt, attemptsRemaining: 5 }, csrfToken: proof }

describe('bounded MFA transport', () => {
  it('accepts only the pending login union and never accepts an accompanying token or user', () => {
    expect(parseMfaRequired(pending).status).toBe('mfa_required')
    expect(() => parseMfaRequired({ ...pending, accessToken: 'unexpected-token' })).toThrow()
    expect(() => parseMfaRequired({ ...pending, user: currentAuthorityFixture() })).toThrow()
  })

  it.each([
    { purpose: 'step_up' }, { attemptsRemaining: 6 }, { id: 'caller-identity' }, { secret: 'short' }, { expiresAt: 'tomorrow' },
  ])('rejects transplanted or malformed pending proof metadata', patch => {
    expect(() => parseMfaRequired({ ...pending, challenge: { ...pending.challenge, ...patch } })).toThrow()
  })

  it('bounds local proof ownership even when the browser clock differs from the server', () => {
    const startedAt = Date.now() - 200_000
    const parsed = parseMfaRequired(pending, startedAt)
    expect(Date.parse(parsed.challenge.expiresAt)).toBeLessThanOrEqual(startedAt + 300_000)
  })

  it('rejects a QR network/data URL and an unexpected secret field', () => {
    const enrollment = { enrollmentId: id, expiresAt, manualKey: 'A'.repeat(32), qrPngBase64: 'iVBORw0KGgo=', issuer: 'Soveris SmartLaunch', accountLabel: 'fixture@example.invalid' }
    expect(parseMfaEnrollment(enrollment, proof, false).enrollmentId).toBe(id)
    expect(() => parseMfaEnrollment({ ...enrollment, qrPngBase64: 'https://qr.example.invalid/private' }, proof, false)).toThrow()
    expect(() => parseMfaEnrollment({ ...enrollment, qrPngBase64: 'data:image/png;base64,iVBORw0KGgo=' }, proof, false)).toThrow()
    expect(() => parseMfaEnrollment({ ...enrollment, secret: 'unexpected' }, proof, false)).toThrow()
  })

  it('requires exactly ten distinct display codes and a mandatory fresh login', () => {
    const recoveryCodes = Array.from({ length: 10 }, (_, index) => index.toString(16).toUpperCase().padStart(4, '0') + '-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')
    const result = { status: 'confirmed', loginRequired: true, recoveryCodes }
    expect(parseMfaCodes(result)).toHaveLength(10)
    expect(() => parseMfaCodes({ ...result, recoveryCodes: recoveryCodes.slice(1) })).toThrow()
    expect(() => parseMfaCodes({ ...result, recoveryCodes: Array(10).fill(recoveryCodes[0]) })).toThrow()
    expect(() => parseMfaCodes({ ...result, loginRequired: false })).toThrow()
  })

  it('rejects primary-only or expired session projection in the MFA completion branch', () => {
    const session = { user: currentAuthorityFixture(), accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresIn: 60 }
    expect(() => parseMfaSession({ status: 'authenticated', session })).toThrow()
    expect(() => parseMfaSession({ status: 'authenticated', session: { ...session, user: { ...session.user, mfaState: 'enrolled', stepUpRequired: false,
      assuranceGeneration: id, assuranceExpiresAt: new Date(Date.now() - 1).toISOString(), freshAssuranceExpiresAt: new Date(Date.now() - 600_001).toISOString() } } })).toThrow()
  })

  it('returns fixed safe errors without server diagnostics, private body or unknown retry claims', () => {
    const safe = normalizeMfaError({ code: 'private-canary', message: 'private-canary', secret: 'private-canary' }, 503, '999999999')
    expect(JSON.stringify(safe)).not.toContain('private-canary')
    expect(safe.retryAfterSeconds).toBeUndefined()
    expect(normalizeMfaError(null, 429, '600').retryAfterSeconds).toBe(600)
  })
})
