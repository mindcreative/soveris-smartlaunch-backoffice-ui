import type { ApiError, ApiErrorResponse } from './apiClient'

const messages: Record<string, string> = {
  authentication_required: 'Authentication required.',
  insufficient_permissions: 'Your current permissions do not allow this action.',
  invalid_request: 'The request is invalid. Review your entries.',
  invalid_hostname: 'Enter a valid public hostname.',
  domain_not_found: 'This domain is unavailable in the current Client.',
  domain_unavailable: 'The requested domain is unavailable.',
  feature_not_available: 'The requested domain feature is unavailable.',
  limit_reached: 'The hostname limit has been reached.',
  configuration_unavailable: 'Domain configuration is unavailable.',
  dependency_unavailable: 'The domain service is temporarily unavailable.',
  stale_capability_evidence: 'Current domain policy could not be confirmed.',
  transition_pending: 'The domain transition is still pending.',
  verification_cooldown: 'Domain verification is cooling down.',
  rate_limit_exceeded: 'Too many verification requests. Wait before checking again.',
  verification_in_progress: 'Verification is already in progress.',
  verification_not_retryable: 'Verification cannot currently be retried.',
  verification_retry_required: 'Start a new verification campaign with Retry.',
  stale_revision: 'The domain revision or eligibility changed. Check current status.',
  time_zone_not_set: 'Set your saved timezone, then reconcile this operation. It may already have committed.',
}

export function normalizeDomainProblem(
  envelope: ApiErrorResponse, status: number | undefined, headerRetry: number | undefined
): ApiError {
  const code = typeof envelope.code === 'string' && Object.prototype.hasOwnProperty.call(messages, envelope.code)
    ? envelope.code : 'DOMAIN_CONTRACT_ERROR'
  const bodyRetry = typeof envelope.retryAfterSeconds === 'number' &&
    Number.isFinite(envelope.retryAfterSeconds) && envelope.retryAfterSeconds >= 0
    ? envelope.retryAfterSeconds : undefined
  const retryAfterSeconds = headerRetry ?? bodyRetry
  const problemDetails: ApiErrorResponse = { status, code }
  if (typeof envelope.traceId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(envelope.traceId))
    problemDetails.traceId = envelope.traceId
  if (typeof envelope.correlationId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.correlationId))
    problemDetails.correlationId = envelope.correlationId
  if (retryAfterSeconds !== undefined) problemDetails.retryAfterSeconds = retryAfterSeconds
  return {
    code, status, message: messages[code] ?? 'The domain response could not be read. Check current status.',
    problemDetails, ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
  }
}
