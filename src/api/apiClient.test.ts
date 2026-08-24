import { describe, expect, it } from 'vitest'
import { apiClient, resolveApiOrigin, type ApiError } from './apiClient'

describe('resolveApiOrigin', () => {
  it('derives the API origin from absolute and relative backoffice bases', () => {
    expect(resolveApiOrigin('https://api.example.com/api/backoffice')).toBe('https://api.example.com')
    expect(resolveApiOrigin('/api/backoffice', 'https://ui.example.com')).toBe('https://ui.example.com')
  })

  it('rejects a non-http API base', () => {
    expect(() => resolveApiOrigin('file:///tmp/api')).toThrow('Invalid API base URL')
  })
})

describe('ApiClient error normalization', () => {
  it('preserves an already normalized error including status', () => {
    const normalized: ApiError = { code: 'HTTP_403', message: 'Denied', status: 403 }
    expect(apiClient.normalizeError(normalized)).toBe(normalized)
  })

  it('supports the Billing flat error envelope', () => {
    expect(
      apiClient.normalizeError({
        response: { status: 404, data: { error: 'Credit account not configured' } },
      })
    ).toEqual({
      code: 'HTTP_404',
      message: 'Credit account not configured',
      status: 404,
    })
  })

  it('supports a text-encoded error envelope from a text response', () => {
    expect(
      apiClient.normalizeError({
        response: { status: 403, data: '{"error":"Insufficient permissions"}' },
      })
    ).toEqual({
      code: 'HTTP_403',
      message: 'Insufficient permissions',
      status: 403,
    })
  })

  it('supports the existing nested error envelope', () => {
    expect(
      apiClient.normalizeError({
        response: {
          status: 401,
          data: { error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } },
        },
      })
    ).toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Authentication required',
      status: 401,
    })
  })

  it('supports the common statusCode/message envelope', () => {
    expect(
      apiClient.normalizeError({
        response: { status: 500, data: { statusCode: 500, message: 'Generic server error' } },
      })
    ).toEqual({
      code: 'HTTP_500',
      message: 'Generic server error',
      status: 500,
    })
  })
})
