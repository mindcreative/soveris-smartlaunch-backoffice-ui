export const GOOGLE_ACCOUNT = {
  prefix: '/api/backoffice/auth/google',
  completePath: '/account/google/complete',
  linkPath: '/account/google/link',
  authorizationOrigin: 'https://accounts.google.com',
  authorizationPath: '/o/oauth2/v2/auth',
  maximumSeconds: 300,
  maximumResponseBytes: 65536,
  deadlineMilliseconds: 15000,
} as const
