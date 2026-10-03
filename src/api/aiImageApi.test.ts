import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiError } from './apiClient'
import {
  AiImageContractError,
  getAiImageJob,
  mapAiImageProblem,
  parseAiImageAdmission,
  parseAiImageAdmissionQuote,
  parseAiImageJobStatus,
  postAiImageAdmission,
  postAiImageAdmissionQuote,
  redeemAiImageResult,
  serializeAiImageRequest,
} from './aiImageApi'
import { useAuthStore } from '../stores/authStore'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const RESERVATION_ID = '01995d88-7740-73f1-8000-000000000002'
const EVENT_ID = '01995d88-7740-73f1-8000-000000000003'
const CORRELATION_ID = '01995d88-7740-73f1-8000-000000000004'
const RESULT_ID = '01995d88-7740-73f1-8000-000000000005'
const QUOTE_ID = 'iaq1_opaque-private-value'

function quoteJson(credits = '1.2345', overrides: Record<string, unknown> = {}): string {
  const value = {
    quoteId: QUOTE_ID, operation: 'image_generation', targetRole: 'hero',
    quotedCredits: '__CREDITS__', ruleVersion: 'pricing-v9',
    issuedAt: '2026-10-02T08:00:00+00:00', expiresAt: '2026-10-02T08:02:00+00:00',
    ...overrides,
  }
  return JSON.stringify(value).replace('"__CREDITS__"', credits)
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    clientId: CLIENT_ID,
    requestType: 'image_generation',
    targetRole: 'hero',
    status: 'pending',
    attemptCount: 0,
    createdAt: '2026-10-02T08:00:00+00:00',
    updatedAt: '2026-10-02T08:00:00+00:00',
    processingStartedAt: null,
    lastAttemptCompletedAt: null,
    completedAt: null,
    quote: { credits: 1.0000, ruleVersion: 'epic5-local-v1-hero' },
    reservation: {
      reservationId: RESERVATION_ID,
      state: 'active',
      estimatedCredits: 1.0000,
      actualCredits: null,
      createdAt: '2026-10-02T08:00:00+00:00',
      expiresAt: '2026-10-02T08:05:00+00:00',
      committedAt: null,
      releasedAt: null,
    },
    result: null,
    resultAccess: null,
    guidance: { code: 'pending', poll: true },
    ...overrides,
  }
}

function completed() {
  return status({
    status: 'completed',
    attemptCount: 1,
    updatedAt: '2026-10-02T08:00:05+00:00',
    processingStartedAt: '2026-10-02T08:00:01+00:00',
    lastAttemptCompletedAt: '2026-10-02T08:00:05+00:00',
    completedAt: '2026-10-02T08:00:05+00:00',
    reservation: {
      reservationId: RESERVATION_ID,
      state: 'committed',
      estimatedCredits: 1.0000,
      actualCredits: 0.7500,
      createdAt: '2026-10-02T08:00:00+00:00',
      expiresAt: '2026-10-02T08:05:00+00:00',
      committedAt: '2026-10-02T08:00:05+00:00',
      releasedAt: null,
    },
    result: {
      resultId: RESULT_ID,
      mediaType: 'image/webp',
      width: 1024,
      height: 768,
      byteSize: 4,
      observedAt: '2026-10-02T08:00:04+00:00',
      createdAt: '2026-10-02T08:00:05+00:00',
      expiresAt: '2026-10-09T08:00:05+00:00',
    },
    resultAccess: { reference: 'opaque-reference', expiresAt: '2026-10-02T08:05:05+00:00' },
    guidance: { code: 'completed', poll: false },
  })
}

describe('AI image closed adapters', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState({ user: {
      id: 'actor', email: 'actor@example.test', displayName: 'Actor', role: 'Admin',
      clientId: CLIENT_ID, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
    } })
  })

  it('serializes only the exact normalized command fields', () => {
    expect(serializeAiImageRequest({
      idempotencyKey: '01995d88-7740-73f1-8000-000000000000',
      prompt: '  a private launch image  ', targetRole: 'feature', quoteId: QUOTE_ID,
    })).toBe(`{"idempotencyKey":"01995d88-7740-73f1-8000-000000000000","prompt":"a private launch image","targetRole":"feature","quoteId":"${QUOTE_ID}"}`)
    expect(() => serializeAiImageRequest({
      idempotencyKey: '01995d88-7740-63f1-8000-000000000000', prompt: 'x', targetRole: 'hero', quoteId: QUOTE_ID,
    })).toThrow(AiImageContractError)
  })

  it('parses legacy and fractional quotes without changing their decimal tokens', () => {
    expect(parseAiImageAdmissionQuote(quoteJson('1.0000'), 'hero').quotedCredits).toBe('1.0000')
    expect(parseAiImageAdmissionQuote(quoteJson('1.2345'), 'hero')).toMatchObject({
      quotedCredits: '1.2345', targetRole: 'hero', ruleVersion: 'pricing-v9',
    })
  })

  it.each([
    ['quoted amount', quoteJson('"1.2345"')],
    ['exponent', quoteJson('1e0')],
    ['excess precision', quoteJson('1.23456')],
    ['zero', quoteJson('0.0000')],
    ['negative', quoteJson('-1.0000')],
    ['out of range', quoteJson('100000000000000.0000')],
    ['wrong operation', quoteJson('1.0000', { operation: 'content_generation' })],
    ['wrong role', quoteJson('1.0000', { targetRole: 'feature' })],
    ['malformed timestamp', quoteJson('1.0000', { expiresAt: '2026-02-30T08:02:00Z' })],
    ['non-UTC timestamp', quoteJson('1.0000', { expiresAt: '2026-10-02T10:02:00+02:00' })],
    ['reversed window', quoteJson('1.0000', { expiresAt: '2026-10-02T08:00:00Z' })],
    ['missing field', JSON.stringify({ quoteId: QUOTE_ID, operation: 'image_generation' })],
    ['unknown field', quoteJson('1.0000', { extra: true })],
    ['duplicate field', quoteJson('1.0000').replace('"operation":', '"operation":"image_generation","operation":')],
  ])('rejects an invalid quote: %s', (_case, body) => {
    expect(() => parseAiImageAdmissionQuote(body, 'hero')).toThrow(AiImageContractError)
  })

  it('parses a 202 receipt losslessly and rejects alternate success or extra fields', () => {
    const body = JSON.stringify({
      jobId: JOB_ID, reservationId: RESERVATION_ID, eventId: EVENT_ID,
      quotedCredits: 1.0000, status: 'reserved', correlationId: CORRELATION_ID, replay: false,
    }).replace('1,"status"', '1.0000,"status"')
    expect(parseAiImageAdmission(body, 202)).toMatchObject({
      jobId: JOB_ID, quotedCredits: '1.0000', status: 'reserved', replay: false,
    })
    expect(() => parseAiImageAdmission(body, 200)).toThrow(AiImageContractError)
    expect(() => parseAiImageAdmission(body.replace('"replay":false', '"replay":false,"extra":1'), 202))
      .toThrow(AiImageContractError)
  })

  it('accepts every public state but rejects identity, decimal, and state-shape mismatches', () => {
    const states = [
      status(),
      status({ status: 'processing', attemptCount: 1, processingStartedAt: '2026-10-02T08:00:01+00:00', updatedAt: '2026-10-02T08:00:01+00:00', guidance: { code: 'processing', poll: true } }),
      status({ status: 'retrying', attemptCount: 1, processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:02+00:00', updatedAt: '2026-10-02T08:00:02+00:00', guidance: { code: 'retrying', poll: true } }),
      status({ status: 'dlq', attemptCount: 6, processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:02+00:00', updatedAt: '2026-10-02T08:00:02+00:00', guidance: { code: 'dlq', poll: true } }),
      completed(),
      status({ status: 'failed', attemptCount: 6, processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:03+00:00', completedAt: '2026-10-02T08:00:03+00:00', updatedAt: '2026-10-02T08:00:03+00:00', reservation: { ...status().reservation, state: 'released', releasedAt: '2026-10-02T08:00:03+00:00' }, guidance: { code: 'failed', poll: false } }),
      status({ status: 'execution_unknown', attemptCount: 1, processingStartedAt: '2026-10-02T08:00:01+00:00', lastAttemptCompletedAt: '2026-10-02T08:00:03+00:00', updatedAt: '2026-10-02T08:00:03+00:00', guidance: { code: 'contact_support', poll: false } }),
    ]
    for (const value of states) {
      const body = JSON.stringify(value).replace(/1,"ruleVersion"/, '1.0000,"ruleVersion"').replace(/1,"actualCredits"/, '1.0000,"actualCredits"')
      expect(parseAiImageJobStatus(body, CLIENT_ID, JOB_ID).status).toBe(value.status)
    }
    expect(() => parseAiImageJobStatus(JSON.stringify(status({ clientId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' })), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
    expect(() => parseAiImageJobStatus(JSON.stringify(status()).replace('"credits":1', '"credits":1e100'), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
    expect(() => parseAiImageJobStatus(JSON.stringify(status({ guidance: { code: 'completed', poll: false } })), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
    expect(() => parseAiImageJobStatus(JSON.stringify(status({ extra: true })), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
    expect(() => parseAiImageJobStatus(JSON.stringify(completed()).replace('"createdAt":"2026-10-02T08:00:05+00:00"', '"createdAt":"2026-10-02T08:00:06+00:00"'), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
  })

  it('accepts only the complete failed reconciliation reservation chains', () => {
    const terminalAt = '2026-10-02T08:06:00+00:00'
    const expiredReservation = {
      ...status().reservation,
      state: 'expired',
      releasedAt: terminalAt,
    }
    const attemptZeroExpiry = status({
      status: 'failed',
      attemptCount: 0,
      updatedAt: terminalAt,
      completedAt: terminalAt,
      reservation: expiredReservation,
      guidance: { code: 'failed', poll: false },
    })
    const retryWaitingExpiry = status({
      status: 'failed',
      attemptCount: 2,
      processingStartedAt: '2026-10-02T08:00:01+00:00',
      lastAttemptCompletedAt: '2026-10-02T08:00:03+00:00',
      updatedAt: terminalAt,
      completedAt: terminalAt,
      reservation: expiredReservation,
      guidance: { code: 'failed', poll: false },
    })
    const staleAttemptExpiry = status({
      ...retryWaitingExpiry,
      attemptCount: 1,
      lastAttemptCompletedAt: terminalAt,
    })
    const staleReleaseAt = '2026-10-02T08:00:03+00:00'
    const staleAttemptRelease = status({
      status: 'failed',
      attemptCount: 1,
      processingStartedAt: '2026-10-02T08:00:01+00:00',
      lastAttemptCompletedAt: staleReleaseAt,
      updatedAt: staleReleaseAt,
      completedAt: staleReleaseAt,
      reservation: { ...status().reservation, state: 'released', releasedAt: staleReleaseAt },
      guidance: { code: 'failed', poll: false },
    })

    for (const value of [attemptZeroExpiry, retryWaitingExpiry, staleAttemptExpiry]) {
      expect(parseAiImageJobStatus(JSON.stringify(value), CLIENT_ID, JOB_ID)).toMatchObject({
        status: 'failed',
        reservation: { state: 'expired', actualCredits: null, committedAt: null, releasedAt: terminalAt },
        result: null,
        resultAccess: null,
        guidance: { code: 'failed', poll: false },
      })
    }
    expect(parseAiImageJobStatus(JSON.stringify(staleAttemptRelease), CLIENT_ID, JOB_ID)).toMatchObject({
      status: 'failed',
      attemptCount: 1,
      reservation: { state: 'released', actualCredits: null, committedAt: null, releasedAt: staleReleaseAt },
      result: null,
      resultAccess: null,
      guidance: { code: 'failed', poll: false },
    })

    const contradictions = [
      { ...attemptZeroExpiry, completedAt: null },
      { ...attemptZeroExpiry, processingStartedAt: '2026-10-02T08:00:01+00:00' },
      { ...attemptZeroExpiry, lastAttemptCompletedAt: terminalAt },
      { ...attemptZeroExpiry, reservation: { ...expiredReservation, releasedAt: null } },
      { ...attemptZeroExpiry, reservation: { ...expiredReservation, actualCredits: 0 } },
      { ...attemptZeroExpiry, reservation: { ...expiredReservation, committedAt: terminalAt } },
      { ...attemptZeroExpiry, reservation: { ...expiredReservation, releasedAt: '2026-10-02T08:04:59+00:00' } },
      { ...retryWaitingExpiry, processingStartedAt: null },
      { ...retryWaitingExpiry, lastAttemptCompletedAt: null },
      { ...retryWaitingExpiry, reservation: { ...expiredReservation, state: 'released' } },
      { ...retryWaitingExpiry, reservation: { ...expiredReservation, state: 'active' } },
      { ...attemptZeroExpiry, reservation: { ...expiredReservation, state: 'released' } },
      { ...attemptZeroExpiry, updatedAt: '2026-10-02T08:05:01+00:00' },
      { ...attemptZeroExpiry, result: completed().result },
      { ...attemptZeroExpiry, resultAccess: completed().resultAccess },
      { ...attemptZeroExpiry, guidance: { code: 'failed', poll: true } },
    ]
    for (const value of contradictions)
      expect(() => parseAiImageJobStatus(JSON.stringify(value), CLIENT_ID, JOB_ID)).toThrow(AiImageContractError)
  })

  it('uses only root routes, exact bodies, AbortSignal, and actor fences', async () => {
    const signal = new AbortController().signal
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      status: 202,
      data: JSON.stringify({ jobId: JOB_ID, reservationId: RESERVATION_ID, eventId: EVENT_ID, quotedCredits: 1, status: 'reserved', correlationId: CORRELATION_ID, replay: false }),
    })
    vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({ status: 200, data: JSON.stringify(status()) })
    await postAiImageAdmission('{"frozen":true}', signal)
    await getAiImageJob(CLIENT_ID, JOB_ID, signal)
    expect(apiClient.postApiRoot).toHaveBeenCalledWith('/api/ai/image-jobs', '{"frozen":true}', expect.objectContaining({ responseType: 'text', signal, retryOnUnauthorized: false }))
    expect(apiClient.getApiRoot).toHaveBeenCalledWith(`/api/ai/jobs/${JOB_ID}`, expect.objectContaining({ responseType: 'text', signal, retryOnUnauthorized: false }))
  })

  it('requests a quote with only the exact target role and parses text losslessly', async () => {
    const signal = new AbortController().signal
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ status: 200, data: quoteJson('1.2345') })
    await expect(postAiImageAdmissionQuote('hero', signal)).resolves.toMatchObject({ quotedCredits: '1.2345' })
    expect(post).toHaveBeenCalledWith('/api/ai/image-admission-quotes', '{"targetRole":"hero"}', {
      responseType: 'text', signal, retryOnUnauthorized: false, headers: { 'Content-Type': 'application/json' },
    })
    const body = String(post.mock.calls[0]?.[1])
    for (const forbidden of ['prompt', 'clientId', 'product', 'provider', 'price', 'idempotencyKey', 'admission'])
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })

  it('redeems exactly once as a verified WebP Blob and rejects type or byte mismatch', async () => {
    const signal = new AbortController().signal
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      status: 200, data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }),
      headers: { 'content-type': 'image/webp' },
    })
    await expect(redeemAiImageResult(JOB_ID, 'opaque-reference', 4, signal)).resolves.toBeInstanceOf(Blob)
    expect(apiClient.postApiRoot).toHaveBeenCalledWith(`/api/ai/jobs/${JOB_ID}/result-redemptions`, { reference: 'opaque-reference' }, expect.objectContaining({ responseType: 'blob', signal, retryOnUnauthorized: false }))
    vi.mocked(apiClient.postApiRoot).mockResolvedValueOnce({ status: 200, data: new Blob(['bad'], { type: 'text/plain' }) })
    await expect(redeemAiImageResult(JOB_ID, 'opaque-reference', 3, signal)).rejects.toThrow(AiImageContractError)
    vi.mocked(apiClient.postApiRoot).mockResolvedValueOnce({ status: 200, data: new Blob(['bad'], { type: 'image/webp' }) })
    await expect(redeemAiImageResult(JOB_ID, 'opaque-reference', 4, signal)).rejects.toThrow(AiImageContractError)
  })

  it.each([
    [402, 'insufficient_credits', 'insufficient_credits', null],
    [401, 'authentication_required', 'authentication_required', null],
    [403, 'forbidden', 'forbidden', null],
    [404, 'job_not_found', 'not_found', null],
    [409, 'idempotency_conflict', 'idempotency_conflict', null],
    [409, 'quote_expired', 'quote_expired', null],
    [409, 'quote_stale', 'quote_stale', null],
    [422, 'quote_not_available', 'quote_not_available', null],
    [413, 'request_body_too_large', 'validation', null],
    [422, 'invalid_image_request', 'validation', null],
    [429, 'back_pressure', 'rate_limited', 60],
    [429, 'limit_reached', 'rate_limited', 60],
    [503, 'admission_outcome_unknown', 'admission_unknown', null],
    [503, 'dependency_unavailable', 'dependency_unavailable', null],
    [503, 'configuration_unavailable', 'configuration_unavailable', null],
    [503, 'transition_pending', 'transition_pending', null],
  ])('maps %s/%s to sanitized %s', (httpStatus, code, kind, retryAfterSeconds) => {
    const error = { status: httpStatus, code, message: 'RAW INTERNAL DETAIL', retryAfterSeconds: 9999 } satisfies ApiError
    expect(mapAiImageProblem(error, 'admission')).toMatchObject({ kind, retryAfterSeconds })
    expect(mapAiImageProblem(error, 'admission').message).not.toContain('RAW')
  })

  it('distinguishes redemption expiry and uncertain transport without raw details', () => {
    expect(mapAiImageProblem({ status: 404, code: 'result_not_available', message: 'raw' }, 'redemption').kind).toBe('result_expired')
    expect(mapAiImageProblem({ code: 'NETWORK_ERROR', message: 'raw' }, 'admission').kind).toBe('admission_unknown')
    expect(mapAiImageProblem({ code: 'NETWORK_ERROR', message: 'raw' }, 'status').kind).toBe('network')
  })
})
