import type { ApiError } from '../api/apiClient'
import { ACCOUNT_CORRELATION_PATTERN, ACCOUNT_ERROR_MESSAGES, ACCOUNT_LIMITS } from './constants/accountLifecycle'

export function normalizeAccountError(body: unknown, status?: number, retryAfter?: unknown, correlationHeader?: unknown): ApiError {
  const envelope = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const fallbackCode = status === 400 ? 'invalid_account_request'
    : status === 401 ? 'invalid_pending_authority'
      : status === 429 ? 'account_flow_limited'
        : status === 503 ? 'account_flow_unavailable' : 'account_flow_uncertain'
  const knownCode = typeof envelope.code === 'string' && Object.prototype.hasOwnProperty.call(ACCOUNT_ERROR_MESSAGES, envelope.code)
  const code = knownCode ? envelope.code as keyof typeof ACCOUNT_ERROR_MESSAGES : fallbackCode
  const normalized: ApiError = { code, message: ACCOUNT_ERROR_MESSAGES[code], status }
  const seconds = typeof retryAfter === 'number' ? retryAfter
    : typeof retryAfter === 'string' && /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : NaN
  const correlationId = envelope.correlationId ?? correlationHeader

  if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= ACCOUNT_LIMITS.maximumRetrySeconds) {
    normalized.retryAfterSeconds = seconds
  }

  if (typeof envelope.loginRequired === 'boolean') {
    normalized.loginRequired = envelope.loginRequired
  }

  if (typeof correlationId === 'string' && ACCOUNT_CORRELATION_PATTERN.test(correlationId)) {
    normalized.correlationId = correlationId.toLowerCase()
  }

  return normalized
}
