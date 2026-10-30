export const ACCOUNT_ROUTES = ['/signup', '/login', '/check-email', '/verify-email', '/forgot-password', '/reset-password', '/account/google/complete', '/account/google/link'] as const

export const ACCOUNT_ENDPOINTS = {
  register: '/auth/register',
  resend: '/auth/registration/resend',
  correctEmail: '/auth/registration/correct-email',
  verify: '/auth/registration/verify',
  forgot: '/auth/password/forgot',
  reset: '/auth/password/reset',
  proofContext: '/auth/registration/proof-context',
} as const

export const ACCOUNT_LIMITS = {
  pendingSeconds: 86400,
  resendPacingSeconds: 60,
  maximumRetrySeconds: 600,
  minimumPasswordScalars: 15,
  maximumPasswordScalars: 128,
  maximumPasswordBytes: 512,
  maximumEmailInput: 262,
} as const

export const ACCOUNT_PROOF_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
export const ACCOUNT_CORRELATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const ACCOUNT_ERROR_MESSAGES = {
  challenge_required: 'Please complete the security check again.',
  account_temporarily_unavailable: 'Account services are temporarily unavailable. Please try again shortly.',
  registration_paused: 'New registrations are temporarily paused. Existing customers can still log in.',
  account_rate_limited: 'Too many attempts. Please wait and try again.',
  invalid_account_request: 'Check the email and password requirements and try again. Common or easily guessed passwords are not accepted.',
  invalid_or_expired_proof: 'This link or continuation could not be accepted. Reopen the newest applicable email or request a fresh recovery link.',
  invalid_pending_authority: 'This signup request is no longer available. Reopen your email link and use your original signup password.',
  invalid_google_flow: 'This Google attempt could not be accepted. Start a fresh Google sign-in. Existing accounts require their own fresh proof before linking.',
  account_flow_limited: 'Too many attempts. Please wait and try again.',
  account_flow_unavailable: 'Account services are temporarily unavailable. Please try again shortly.',
  account_flow_uncertain: 'The result could not be confirmed. If you completed activation, try logging in. Otherwise reopen your email before retrying.',
} as const

export const ACCOUNT_INPUT_CLASS = 'mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 py-2.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
export const ACCOUNT_BUTTON_CLASS = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-solid px-4 py-2.5 text-sm font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const ACCOUNT_LINK_CLASS = 'inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
