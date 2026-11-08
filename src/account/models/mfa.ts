import type { AuthResponse, AuthUser } from '../../types/auth'

export type MfaState = 'none' | 'enrolled' | 'recovery-required'
export type MfaPrimaryPurpose = 'enrollment' | 'replacement' | 'factor_change'
export type MfaStepUpPurpose = 'step_up' | 'google_link' | 'factor_change'
export type MfaPurpose = 'login' | 'support_activation' | MfaPrimaryPurpose | MfaStepUpPurpose

export interface MfaProjection {
  mfaState: MfaState
  stepUpRequired: boolean
  assuranceExpiresAt: string | null
  freshAssuranceExpiresAt: string | null
  assuranceGeneration: string | null
}

export interface MfaChallenge {
  id: string
  secret: string
  purpose: MfaPurpose
  expiresAt: string
  attemptsRemaining: number
}

export interface MfaRequired {
  status: 'mfa_required'
  challenge: MfaChallenge & { purpose: 'login' }
  csrfToken: string
}

export type PasswordLoginResult = (AuthResponse & { user: AuthUser }) | MfaRequired
export type MfaLoginDisposition = boolean | 'mfa_required'

export interface MfaBoundChallenge {
  challenge: MfaChallenge
  csrfToken: string
}

export interface MfaEnrollment {
  enrollmentId: string
  expiresAt: string
  manualKey: string
  qrPngBase64: string
  issuer: string
  accountLabel: string
  csrfToken: string
  recovery: boolean
}

export interface MfaRecoveryContinuation {
  id: string
  secret: string
  expiresAt: string
  csrfToken: string
}

export interface MfaSecurityStatus {
  mfaState: MfaState
  mandatoryForPrivilege: boolean
  hasLocalPassword: boolean
  googleReauthenticationAvailable: boolean
}

export interface MfaOperation {
  signal: AbortSignal
  isCurrent: () => boolean
  pageIsCurrent: () => boolean
}

export interface MfaFlowDependencies {
  now: () => number
  epoch: () => number
  session: () => string
}

export interface MfaFlowSnapshot {
  login: MfaBoundChallenge | null
  primary: MfaBoundChallenge | null
  stepUp: MfaBoundChallenge | null
  recovery: MfaRecoveryContinuation | null
  freshRecoveryPrimary: MfaBoundChallenge | null
  enrollment: MfaEnrollment | null
  codes: readonly string[] | null
  codesExpireAt: number | null
  returnPath: string | null
  linkAfterLogin: boolean
}

export interface MfaActionState {
  pending: boolean
  error: import('../../api/apiClient').ApiError | null
  retryAt: number
  run: (action: (operation: MfaOperation) => Promise<void>) => Promise<void>
}

export interface MfaLayoutProps {
  title: string
  description?: string
  action?: MfaActionState
  children: import('react').ReactNode
}

export interface TotpInputProps {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  disabled?: boolean
}
