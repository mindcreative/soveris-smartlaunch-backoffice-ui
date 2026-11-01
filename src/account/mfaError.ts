import type { ApiError } from '../api/apiClient'
import { MFA } from './constants/mfa'

const messages = {
  invalid_mfa_flow: 'This code or security attempt could not be accepted. Check the current code, or start a fresh attempt.',
  account_rate_limited: 'Too many security attempts. Wait before trying again.',
  authorization_unavailable: 'Security verification is temporarily unavailable. Your code may have been used; start a fresh attempt when service returns.',
  authentication_required: 'Verify your current session before continuing.',
  mfa_flow_uncertain: 'This result could not be confirmed. Start a fresh sign-in or recovery attempt. A completed code display cannot be reopened.',
} as const

export function normalizeMfaError(value: unknown, status?: number, retry?: unknown): ApiError {
  const supplied = value && typeof value === 'object' && 'code' in value ? value.code : null
  const code = status === 429 ? 'account_rate_limited' : status === 503 ? 'authorization_unavailable'
    : status === 401 ? 'authentication_required' : supplied === 'invalid_mfa_flow' ? 'invalid_mfa_flow' : 'mfa_flow_uncertain'
  const candidate = typeof retry === 'number' ? retry : typeof retry === 'string' && /^\d{1,3}$/.test(retry) ? Number(retry) : undefined
  const seconds = candidate !== undefined && Number.isSafeInteger(candidate) && candidate > 0 && candidate <= MFA.maximumRetrySeconds ? candidate : undefined

  return { code, message: messages[code], ...(status === undefined ? {} : { status }), ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }) }
}
