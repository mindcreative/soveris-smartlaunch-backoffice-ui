import type { AuthResponse } from '../types/auth'
import type { MfaBoundChallenge, MfaChallenge, MfaEnrollment, MfaPurpose, MfaRequired, MfaSecurityStatus } from './models/mfa'
import { MFA, MFA_UTC_INSTANT, MFA_UUID_V7 } from './constants/mfa'
import { ACCOUNT_PROOF_PATTERN } from './constants/accountLifecycle'
import { normalizeMfaError } from './mfaError'
import { hasMfaAssurance } from '../auth/mfaAuthority'
import { parseCurrentAuthority } from '../auth/currentAuthority'

export function invalidMfaResponse(): never {
  throw normalizeMfaError(null, 503)
}

export function mfaObject(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidMfaResponse()
  }

  const object = value as Record<string, unknown>

  if (allowed && Object.keys(object).some(key => !allowed.includes(key))) {
    return invalidMfaResponse()
  }

  return object
}

export function mfaExpiry(value: unknown, maximumMilliseconds: number, startedAt = Date.now()): string {
  if (typeof value !== 'string' || !MFA_UTC_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    return invalidMfaResponse()
  }

  const expires = Math.min(Date.parse(value), startedAt + maximumMilliseconds)

  if (expires <= Date.now()) {
    return invalidMfaResponse()
  }

  return new Date(expires).toISOString()
}

export function mfaSecret(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_PROOF_PATTERN.test(value)) {
    return invalidMfaResponse()
  }

  return value
}

export function mfaId(value: unknown): string {
  if (typeof value !== 'string' || !MFA_UUID_V7.test(value)) {
    return invalidMfaResponse()
  }

  return value
}

export function parseMfaChallenge(value: unknown, purposes: readonly MfaPurpose[], startedAt = Date.now()): MfaBoundChallenge {
  const body = mfaObject(value, ['challenge', 'csrfToken'])
  const challenge = mfaObject(body.challenge, ['id', 'secret', 'purpose', 'expiresAt', 'attemptsRemaining'])

  if (!purposes.includes(challenge.purpose as MfaPurpose) || challenge.attemptsRemaining !== MFA.maximumAttempts) {
    return invalidMfaResponse()
  }

  return { challenge: { id: mfaId(challenge.id), secret: mfaSecret(challenge.secret), purpose: challenge.purpose as MfaPurpose,
    expiresAt: mfaExpiry(challenge.expiresAt, MFA.challengeMilliseconds, startedAt), attemptsRemaining: MFA.maximumAttempts }, csrfToken: mfaSecret(body.csrfToken) }
}

export function parseMfaRequired(value: unknown, startedAt = Date.now()): MfaRequired {
  const body = mfaObject(value, ['status', 'challenge', 'csrfToken'])

  if (body.status !== 'mfa_required') {
    return invalidMfaResponse()
  }

  const bound = parseMfaChallenge({ challenge: body.challenge, csrfToken: body.csrfToken }, ['login'], startedAt)

  return { status: 'mfa_required', challenge: bound.challenge as MfaChallenge & { purpose: 'login' }, csrfToken: bound.csrfToken }
}

export function parseMfaEnrollment(value: unknown, csrfToken: string, recovery: boolean, startedAt = Date.now()): MfaEnrollment {
  const body = mfaObject(value, ['enrollmentId', 'expiresAt', 'manualKey', 'qrPngBase64', 'issuer', 'accountLabel'])

  if (typeof body.manualKey !== 'string' || !/^[A-Z2-7]{32}$/.test(body.manualKey) || typeof body.qrPngBase64 !== 'string'
    || body.qrPngBase64.length > MFA.maximumQrCharacters || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.qrPngBase64)
    || body.issuer !== MFA.issuer || typeof body.accountLabel !== 'string' || !body.accountLabel || body.accountLabel.length > 262) {
    return invalidMfaResponse()
  }

  return { enrollmentId: mfaId(body.enrollmentId), expiresAt: mfaExpiry(body.expiresAt, MFA.enrollmentMilliseconds, startedAt),
    manualKey: body.manualKey, qrPngBase64: body.qrPngBase64, issuer: body.issuer, accountLabel: body.accountLabel, csrfToken: mfaSecret(csrfToken), recovery }
}

export function parseMfaCodes(value: unknown): string[] {
  const body = mfaObject(value, ['status', 'recoveryCodes', 'loginRequired'])

  if (body.status !== 'confirmed' && body.status !== 'regenerated' || body.loginRequired !== true || !Array.isArray(body.recoveryCodes)
    || body.recoveryCodes.length !== MFA.recoveryCount || body.recoveryCodes.some(code => typeof code !== 'string' || !/^[0-9A-F]{4}(?:-[0-9A-F]{4}){7}$/.test(code))
    || new Set(body.recoveryCodes).size !== MFA.recoveryCount) {
    return invalidMfaResponse()
  }

  return [...body.recoveryCodes] as string[]
}

export function parseMfaSession(value: unknown): AuthResponse {
  const body = mfaObject(value, ['status', 'session'])
  const session = mfaObject(body.session, ['accessToken', 'refreshToken', 'expiresIn', 'user'])

  if (body.status !== 'authenticated' || typeof session.accessToken !== 'string' || !session.accessToken || typeof session.refreshToken !== 'string'
    || !session.refreshToken || typeof session.expiresIn !== 'number' || !Number.isSafeInteger(session.expiresIn) || session.expiresIn <= 0) {
    return invalidMfaResponse()
  }

  const user = parseCurrentAuthority(session.user)

  if (!hasMfaAssurance(user)) {
    return invalidMfaResponse()
  }

  return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn, user }
}

export function parseMfaStatus(value: unknown): MfaSecurityStatus {
  const body = mfaObject(value, ['mfaState', 'mandatoryForPrivilege', 'hasLocalPassword', 'googleReauthenticationAvailable'])

  if (!['none', 'enrolled', 'recovery-required'].includes(String(body.mfaState)) || typeof body.mandatoryForPrivilege !== 'boolean'
    || typeof body.hasLocalPassword !== 'boolean' || typeof body.googleReauthenticationAvailable !== 'boolean') {
    return invalidMfaResponse()
  }

  return body as unknown as MfaSecurityStatus
}
