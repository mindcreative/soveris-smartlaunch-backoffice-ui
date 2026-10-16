import { describe, expect, it } from 'vitest'
import { ApiClient } from './apiClient'

const client = new ApiClient()
const response = (status: number, data: unknown, headers = {}) => ({
  config: { url: '/domains/01990000-0000-7000-8000-000000000001/verify' },
  response: { status, data, headers },
})

describe('domain ProblemDetails normalization', () => {
  it('retains body-only retry timing and safe correlation without provider material', () => {
    const error = client.normalizeError(response(503, {
      status: 503, code: 'configuration_unavailable', detail: 'Verification unavailable.',
      traceId: '00-abc-123', correlationId: '01990000-0000-7000-8000-000000000001',
      retryAfterSeconds: 17, provider: 'private-sentinel', lease: 'private-sentinel',
    }))
    expect(error.retryAfterSeconds).toBe(17)
    expect(error.problemDetails).toEqual({
      status: 503, code: 'configuration_unavailable', traceId: '00-abc-123',
      correlationId: '01990000-0000-7000-8000-000000000001', retryAfterSeconds: 17,
    })
    expect(JSON.stringify(error)).not.toContain('private-sentinel')
  })
  it('keeps the actual 429 diagnosis and gives Retry-After precedence', () => {
    const error = client.normalizeError(response(429, {
      code: 'verification_cooldown', detail: 'Cooling down.', retryAfterSeconds: 3,
      traceId: 'trace-1', correlationId: '01990000-0000-7000-8000-000000000001',
    }, { 'retry-after': '21' }))
    expect(error.code).toBe('verification_cooldown')
    expect(error.retryAfterSeconds).toBe(21)
    expect(error.problemDetails?.traceId).toBe('trace-1')
  })
  it('rejects unsafe timing and correlation metadata', () => {
    const error = client.normalizeError(response(503, {
      code: 'dependency_unavailable', detail: 'Unavailable.', retryAfterSeconds: -1,
      traceId: { private: true }, correlationId: 'foreign-client',
    }))
    expect(error.retryAfterSeconds).toBeUndefined()
    expect(error.problemDetails).toEqual({ status: 503, code: 'dependency_unavailable' })
  })
})
