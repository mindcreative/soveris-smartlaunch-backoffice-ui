export const MFA = {
  prefix: '/auth/mfa',
  sameOriginBase: '/api/backoffice',
  csrfHeader: 'X-MFA-CSRF',
  challengeMilliseconds: 300_000,
  enrollmentMilliseconds: 600_000,
  assuranceMilliseconds: 900_000,
  freshMilliseconds: 300_000,
  maximumResponseBytes: 131_072,
  maximumQrCharacters: 100_000,
  deadlineMilliseconds: 15_000,
  maximumAttempts: 5,
  recoveryCount: 10,
  maximumRetrySeconds: 600,
  issuer: 'Soveris SmartLaunch',
  recoveryPopupProtocol: 'soveris-mfa-recovery-primary-v1',
  recoveryPopupPollMilliseconds: 250,
  recoveryPopupReadyMilliseconds: 500,
} as const

export const MFA_ROUTES = {
  security: '/account/security',
  enroll: '/account/mfa/enroll',
  challenge: '/account/mfa/challenge',
  recover: '/account/mfa/recover',
  googleComplete: '/account/google/reauth-complete',
} as const

export const MFA_PENDING_PATHS = [
  '/auth/mfa/login/verify', '/auth/mfa/login/cancel', '/auth/mfa/recovery/consume', '/auth/mfa/recovery/redeem',
  '/auth/mfa/recovery/cancel', '/auth/mfa/recovery/enrollment/start', '/auth/mfa/recovery/enrollment/confirm',
] as const

export const MFA_AUTHENTICATED_PATHS = [
  '/auth/mfa/status', '/auth/mfa/reauth/password', '/auth/mfa/enrollment/start', '/auth/mfa/enrollment/confirm',
  '/auth/mfa/enrollment/cancel', '/auth/mfa/challenge/start', '/auth/mfa/challenge/verify', '/auth/mfa/challenge/cancel',
  '/auth/mfa/recovery-codes/regenerate', '/auth/mfa/factor/remove',
] as const

export const MFA_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MFA_TOTP_CODE = /^[0-9]{6}$/
export const MFA_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/
