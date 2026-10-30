export interface AccountAdmissionContext {
  contextId: string
  nonce: string
  csrf: string
  expiresIn: number
  challengeOrigin: string
  siteKey: string
}

export interface SignupChallengeAdmission {
  contextId: string
  token: string
  csrf: string
}

export type ChallengeStatus = 'loading' | 'checking' | 'ready' | 'consumed' | 'expired' | 'unavailable'

export interface TurnstileState {
  context: AccountAdmissionContext | null
  status: ChallengeStatus
  error: ApiError | null
  retryAt: number
  retry: () => void
  outcome: (type: 'ready' | 'success' | 'expired' | 'error' | 'timeout', token?: string) => void
  consume: () => SignupChallengeAdmission
}

export interface TurnstileChallengeProps {
  challenge: TurnstileState
}
import type { ApiError } from '../../api/apiClient'
