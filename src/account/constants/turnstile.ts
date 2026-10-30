export const ACCOUNT_ADMISSION = {
  contextPath: '/api/backoffice/auth/admission/context',
  registerPath: '/api/backoffice/auth/register',
  csrfHeader: 'X-Account-Admission-CSRF',
  deadlineMilliseconds: 10000,
  childReadinessMilliseconds: 15000,
  maximumBytes: 16384,
  maximumSeconds: 300,
  maximumTokenCharacters: 2048,
  action: 'account_signup',
} as const

export const CHALLENGE_MESSAGES = {
  init: 'account-challenge:init',
  ready: 'account-challenge:ready',
  success: 'account-challenge:success',
  expired: 'account-challenge:expired',
  error: 'account-challenge:error',
  timeout: 'account-challenge:timeout',
} as const
