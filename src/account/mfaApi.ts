import { apiClient } from '../api/apiClient'
import { parseCurrentAuthority } from '../auth/currentAuthority'
import type { AuthUser, LoginCredentials } from '../types/auth'
import { MFA } from './constants/mfa'
import { normalizeMfaError } from './mfaError'
import { invalidMfaResponse, mfaExpiry, mfaId, mfaObject, mfaSecret, parseMfaChallenge, parseMfaCodes, parseMfaEnrollment, parseMfaRequired, parseMfaSession, parseMfaStatus } from './mfaParsing'
import type { MfaBoundChallenge, MfaEnrollment, MfaPrimaryPurpose, MfaRecoveryContinuation, MfaStepUpPurpose } from './models/mfa'

async function request(path: string, body: unknown | undefined, csrf: string | undefined, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const config = { baseURL: MFA.sameOriginBase, timeout: MFA.deadlineMilliseconds, retryOnUnauthorized: false, signal,
    responseType: 'text' as const, transformResponse: [(value: unknown) => value], maxContentLength: MFA.maximumResponseBytes,
    headers: { ...(csrf ? { [MFA.csrfHeader]: csrf } : {}) } }
  const result = body === undefined ? await apiClient.get<unknown>(MFA.prefix + path, config)
    : await apiClient.post<unknown>(MFA.prefix + path, body, config)

  if (typeof result.data !== 'string' || new TextEncoder().encode(result.data).byteLength > MFA.maximumResponseBytes) {
    return invalidMfaResponse()
  }

  try {
    return mfaObject(JSON.parse(result.data))
  } catch {
    throw normalizeMfaError(null, 503)
  }
}

function proof(bound: MfaBoundChallenge) {
  return { challengeId: bound.challenge.id, challengeSecret: bound.challenge.secret }
}

async function cancelled(path: string, body: unknown, csrf: string, signal?: AbortSignal): Promise<void> {
  const result = await request(path, body, csrf, signal)

  if (result.status !== 'cancelled' || Object.keys(result).length !== 1) {
    invalidMfaResponse()
  }
}

export const mfaApi = {
  async status(signal?: AbortSignal) {
    return parseMfaStatus(await request('/status', undefined, undefined, signal))
  },
  async password(password: string, purpose: MfaPrimaryPurpose, signal?: AbortSignal, csrf?: string): Promise<MfaBoundChallenge> {
    const started = Date.now()

    return parseMfaChallenge(await request('/reauth/password', { password, purpose }, csrf, signal), [purpose], started)
  },
  async startEnrollment(primary: MfaBoundChallenge, signal?: AbortSignal): Promise<MfaEnrollment> {
    const started = Date.now()

    return parseMfaEnrollment(await request('/enrollment/start', proof(primary), primary.csrfToken, signal), primary.csrfToken, false, started)
  },
  async confirm(enrollment: MfaEnrollment, code: string, signal?: AbortSignal): Promise<string[]> {
    const path = enrollment.recovery ? '/recovery/enrollment/confirm' : '/enrollment/confirm'

    return parseMfaCodes(await request(path, { enrollmentId: enrollment.enrollmentId, code }, enrollment.csrfToken, signal))
  },
  async cancelEnrollment(enrollment: MfaEnrollment, signal?: AbortSignal): Promise<void> {
    await cancelled(enrollment.recovery ? '/recovery/cancel' : '/enrollment/cancel', { enrollmentId: enrollment.enrollmentId }, enrollment.csrfToken, signal)
  },
  async startChallenge(purpose: MfaStepUpPurpose, signal?: AbortSignal, csrf?: string): Promise<MfaBoundChallenge> {
    const started = Date.now()

    return parseMfaChallenge(await request('/challenge/start', { purpose }, csrf, signal), [purpose], started)
  },
  async verifyChallenge(bound: MfaBoundChallenge, code: string, signal?: AbortSignal): Promise<AuthUser> {
    return parseCurrentAuthority(await request('/challenge/verify', { ...proof(bound), purpose: bound.challenge.purpose, code }, bound.csrfToken, signal))
  },
  async cancelChallenge(bound: MfaBoundChallenge, signal?: AbortSignal): Promise<void> {
    await cancelled('/challenge/cancel', { ...proof(bound), purpose: bound.challenge.purpose }, bound.csrfToken, signal)
  },
  async verifyLogin(bound: MfaBoundChallenge, code: string, signal?: AbortSignal) {
    return parseMfaSession(await request('/login/verify', { ...proof(bound), code }, bound.csrfToken, signal))
  },
  async cancelLogin(bound: MfaBoundChallenge, signal?: AbortSignal): Promise<void> {
    await cancelled('/login/cancel', proof(bound), bound.csrfToken, signal)
  },
  async recover(bound: MfaBoundChallenge, code: string, ticket = false, signal?: AbortSignal): Promise<MfaRecoveryContinuation> {
    const started = Date.now()
    const result = mfaObject(await request(ticket ? '/recovery/redeem' : '/recovery/consume', { ...proof(bound), [ticket ? 'ticket' : 'recoveryCode']: code }, bound.csrfToken, signal),
      ['status', 'continuation', 'csrfToken'])
    const continuation = mfaObject(result.continuation, ['id', 'secret', 'expiresAt'])

    if (result.status !== 'reenrollment_required') {
      return invalidMfaResponse()
    }

    return { id: mfaId(continuation.id), secret: mfaSecret(continuation.secret), expiresAt: mfaExpiry(continuation.expiresAt, MFA.enrollmentMilliseconds, started), csrfToken: mfaSecret(result.csrfToken) }
  },
  async recoveryEnrollment(continuation: MfaRecoveryContinuation, fresh?: MfaBoundChallenge | null, signal?: AbortSignal): Promise<MfaEnrollment> {
    const started = Date.now()
    const result = await request('/recovery/enrollment/start', { challengeId: continuation.id, challengeSecret: continuation.secret,
      ...(fresh ? { freshChallengeId: fresh.challenge.id, freshChallengeSecret: fresh.challenge.secret, freshCsrfToken: fresh.csrfToken } : {}) }, continuation.csrfToken, signal)

    const enrollment = parseMfaEnrollment(result, continuation.csrfToken, true, started)

    return { ...enrollment, expiresAt: new Date(Math.min(Date.parse(enrollment.expiresAt), Date.parse(continuation.expiresAt))).toISOString() }
  },
  async cancelRecovery(continuation: MfaRecoveryContinuation, signal?: AbortSignal): Promise<void> {
    await cancelled('/recovery/cancel', { challengeId: continuation.id, challengeSecret: continuation.secret }, continuation.csrfToken, signal)
  },
  async changeFactor(primary: MfaBoundChallenge, remove = false, signal?: AbortSignal): Promise<string[] | null> {
    const result = await request(remove ? '/factor/remove' : '/recovery-codes/regenerate', { ...proof(primary), ...(remove ? { confirm: true } : {}) }, primary.csrfToken, signal)

    if (!remove) {
      return parseMfaCodes(result)
    }

    if (result.status !== 'removed' || result.loginRequired !== true || result.recoveryCodes !== null) {
      return invalidMfaResponse()
    }

    return null
  },
  async freshRecoveryPrimary(credentials: LoginCredentials, signal?: AbortSignal): Promise<MfaBoundChallenge> {
    const started = Date.now()
    const result = await apiClient.post<unknown>('/auth/login', credentials, { baseURL: MFA.sameOriginBase, signal, retryOnUnauthorized: false })
    const required = parseMfaRequired(result.data, started)

    return { challenge: required.challenge, csrfToken: required.csrfToken }
  },
}
