import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import {
  AiContentContractError,
  getAiContentJob,
  parseAiContentAdmission,
  parseAiJobStatus,
  postAiContentGeneration,
  serializeAiContentRequest,
} from './aiContentApi'
import type { AiContentGenerationRequest } from '../types/aiContent'
import { useAuthStore } from '../stores/authStore'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const RESERVATION_ID = '01995d88-7740-73f1-8000-000000000002'
const ATTEMPT_ID = '01995d88-7740-73f1-8000-000000000003'
const CORRELATION_ID = '01995d88-7740-73f1-8000-000000000004'

const request: AiContentGenerationRequest = {
  idempotencyKey: '01995d88-7740-73f1-8000-000000000000',
  operation: 'generate_content', contentType: 'hero', productSlug: null,
  productName: null, existingContent: null, targetAudience: null,
  tone: null, variations: 1, instructions: null, content: null,
}

function pendingJob(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    jobId: JOB_ID, clientId: CLIENT_ID, requestType: 'content_generation', status: 'reserved',
    correlationId: CORRELATION_ID, submittedByUserId: CLIENT_ID,
    createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:00Z',
    processingStartedAt: null, completedAt: null, result: null,
    attempt: { attemptId: ATTEMPT_ID, attemptNumber: 1, outcomeStatus: 'processing', executionPhase: 'pre_dispatch', providerName: null, failureCategory: null, retryDisposition: null, startedAt: '2026-09-28T10:00:00Z', completedAt: null },
    reservation: { reservationId: RESERVATION_ID, state: 'active', estimatedCredits: '__CREDITS__', actualCredits: null, createdAt: '2026-09-28T10:00:00Z', expiresAt: '2026-09-28T10:05:00Z', committedAt: null, releasedAt: null },
    usage: null, providerCost: null,
    guidance: { code: 'pending', poll: true, action: 'wait' },
    ...overrides,
  }).replace('"__CREDITS__"', '1.2500')
}

describe('AI content adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState({
      user: { id: CLIENT_ID, clientId: CLIENT_ID, email: 'editor@example.test', displayName: 'Editor', role: 'Editor', accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 },
      isAuthenticated: true,
    })
  })
  it('serializes all eleven fields in fixed order and preserves nulls', () => {
    expect(serializeAiContentRequest(request)).toBe('{"idempotencyKey":"01995d88-7740-73f1-8000-000000000000","operation":"generate_content","contentType":"hero","productSlug":null,"productName":null,"existingContent":null,"targetAudience":null,"tone":null,"variations":1,"instructions":null,"content":null}')
  })

  it.each([
    ['generate_content', 'features'], ['generate_seo', 'meta_title'],
    ['generate_headline', 'headline'], ['generate_image_prompt', 'image_prompt'],
    ['rewrite_content', 'description'],
  ] as const)('accepts delivered operation %s and content type %s', (operation, contentType) => {
    const value = { ...request, operation, contentType, content: operation === 'rewrite_content' ? '0123456789' : null }
    expect(() => serializeAiContentRequest(value)).not.toThrow()
  })

  it('rejects invalid UUID, bounds, rewrite content, extra fields, and unsupported tokens', () => {
    expect(() => serializeAiContentRequest({ ...request, idempotencyKey: crypto.randomUUID() })).toThrow(AiContentContractError)
    expect(() => serializeAiContentRequest({ ...request, variations: 11 })).toThrow(AiContentContractError)
    expect(() => serializeAiContentRequest({ ...request, operation: 'rewrite_content', content: 'short' })).toThrow(AiContentContractError)
    expect(() => serializeAiContentRequest({ ...request, extra: true } as never)).toThrow(AiContentContractError)
    expect(() => serializeAiContentRequest({ ...request, operation: 'generate_image' as never })).toThrow(AiContentContractError)
  })

  it('parses exact 200 and 202 responses without coercing decimal credits', () => {
    const completed = parseAiContentAdmission(JSON.stringify({
      jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID,
      status: 'completed', variations: ['One'], providerName: 'fixture', modelName: 'fixture-v1',
      usage: { inputTokens: 12, outputTokens: 5 }, committedCredits: '__CREDITS__',
      correlationId: CORRELATION_ID, replay: false,
    }).replace('"__CREDITS__"', '1.2300'), 200)
    expect(completed.kind).toBe('completed')
    expect(completed.kind === 'completed' && completed.committedCredits).toBe('1.2300')

    const accepted = parseAiContentAdmission(JSON.stringify({
      jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID,
      quotedCredits: '__CREDITS__', status: 'processing', correlationId: CORRELATION_ID, replay: true,
    }).replace('"__CREDITS__"', '2.5000'), 202)
    expect(accepted).toMatchObject({ kind: 'accepted', quotedCredits: '2.5000', replay: true })
  })

  it.each([
    [200, '{"jobId":"' + JOB_ID + '"}'],
    [202, JSON.stringify({ jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID, quotedCredits: 1, status: 'completed', correlationId: CORRELATION_ID, replay: false })],
    [200, JSON.stringify({ jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID, status: 'completed', variations: ['x'], providerName: 'p', modelName: 'm', usage: { inputTokens: 1, outputTokens: 1 }, committedCredits: 1, correlationId: CORRELATION_ID, replay: false, extra: true })],
  ])('rejects malformed or impossible admission shape', (status, body) => {
    expect(() => parseAiContentAdmission(body, status)).toThrow(AiContentContractError)
  })

  it('posts the caller-retained exact body to only the canonical route', async () => {
    const body = serializeAiContentRequest(request)
    const responseBody = JSON.stringify({ jobId: JOB_ID, reservationId: RESERVATION_ID, attemptId: ATTEMPT_ID, quotedCredits: 1.0000, status: 'reserved', correlationId: CORRELATION_ID, replay: false })
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({ data: responseBody, status: 202 })
    const signal = new AbortController().signal
    await postAiContentGeneration(body, signal, vi.fn())
    expect(post).toHaveBeenCalledWith('/api/ai/content-generations', body, { responseType: 'text', signal, onAuthReplay: expect.any(Function), headers: { 'Content-Type': 'application/json' } })
  })

  it('strictly parses a same-Client pending Job and retains decimal text', () => {
    const result = parseAiJobStatus(pendingJob(), CLIENT_ID, JOB_ID)
    expect(result.reservation.estimatedCredits).toBe('1.2500')
    expect(result.guidance).toEqual({ code: 'pending', poll: true, action: 'wait' })
  })

  it.each([
    pendingJob({ clientId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }),
    pendingJob({ jobId: '01995d88-7740-73f1-8000-000000000099' }),
    pendingJob({ requestType: 'image_generation' }),
    pendingJob({ extra: true }),
    pendingJob({ status: 'completed', guidance: { code: 'pending', poll: true, action: 'wait' } }),
  ])('fails closed for mismatched, non-content, extra, or impossible Job evidence', (body) => {
    expect(() => parseAiJobStatus(body, CLIENT_ID, JOB_ID)).toThrow(AiContentContractError)
  })

  it('GETs only the durable status route', async () => {
    const get = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({ data: pendingJob(), status: 200 })
    await getAiContentJob(CLIENT_ID, JOB_ID, new AbortController().signal)
    expect(get).toHaveBeenCalledWith(`/api/ai/jobs/${JOB_ID}`, { responseType: 'text', signal: expect.any(AbortSignal) })
  })
})
