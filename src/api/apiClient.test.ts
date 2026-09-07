import { describe, expect, it } from 'vitest'
import { apiClient, notifySuccessfulAuthRefresh, resolveApiOrigin, type ApiError } from './apiClient'

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

  it('preserves a stable top-level ProblemDetails code and safe detail', () => {
    expect(
      apiClient.normalizeError({
        response: {
          status: 409,
          data: {
            type: 'about:blank',
            title: 'Subscription conflict',
            status: 409,
            detail: 'The subscription command conflicts with current state.',
            code: 'subscription_current_conflict',
          },
        },
      })
    ).toEqual({
      code: 'subscription_current_conflict',
      message: 'The subscription command conflicts with current state.',
      status: 409,
    })
  })

  it('normalizes an Axios-shaped error before considering its transport code', () => {
    expect(apiClient.normalizeError({
      code: 'ERR_BAD_REQUEST',
      message: 'Request failed with status code 409',
      response: {
        status: 409,
        data: {
          title: 'Subscription conflict',
          detail: 'The operation conflicts.',
          code: 'subscription_operation_conflict',
        },
      },
    })).toEqual({
      code: 'subscription_operation_conflict', message: 'The operation conflicts.', status: 409,
    })
  })

  it('falls back from ProblemDetails detail to title without weakening old envelopes', () => {
    expect(apiClient.normalizeError({
      response: { status: 400, data: '{"title":"Invalid subscription creation request","status":400}' },
    })).toEqual({
      code: 'HTTP_400', message: 'Invalid subscription creation request', status: 400,
    })
  })

  it('does not expose blank ProblemDetails fields as an empty message', () => {
    expect(apiClient.normalizeError({
      response: { status: 500, data: { title: '   ', detail: '\n', status: 500 } },
    })).toEqual({
      code: 'HTTP_500', message: 'Request failed with status 500', status: 500,
    })
  })
})

describe('successful refresh lifecycle', () => {
  it('waits for registered private-state cleanup before continuing', async () => {
    let cleaned = false
    const listener = (event: Event) => {
      const refreshEvent = event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>
      refreshEvent.detail.waitUntil(Promise.resolve().then(() => { cleaned = true }))
    }
    window.addEventListener('auth:refreshed', listener)

    await notifySuccessfulAuthRefresh()

    expect(cleaned).toBe(true)
    window.removeEventListener('auth:refreshed', listener)
  })
})
