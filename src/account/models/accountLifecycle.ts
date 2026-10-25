import type { AuthResponse } from '../../types/auth'

export interface RegisterAccountRequest {
  email: string
  password: string
  returnIntent?: 'create_first_product'
}

export interface PendingAccountResponse {
  status: 'check_email'
  pendingToken: string
  expiresIn: number
}

export interface PendingAccountRequest {
  pendingToken: string
}

export interface CorrectAccountEmailRequest extends PendingAccountRequest {
  email: string
}

export interface ForgotAccountPasswordRequest {
  email: string
}

export interface ResetAccountPasswordRequest {
  proof: string
  newPassword: string
}

export interface PendingAccount {
  pendingToken: string
  email: string
  expiresAt: number
  nextRequestAt: number
}

export type VerifyAccountRequest = { proof: string } & (
  { pendingToken: string; password?: never } | { password: string; pendingToken?: never }
)

export type AccountVerificationResponse =
  | { status: 'activated'; session: AuthResponse; nextAction: string }
  | { status: 'activation_complete'; loginRequired: true }

export interface CapturedAccountProof {
  kind: 'verify' | 'reset'
  proof: string
  expiresAt: number
}

export interface AccountFlowDependencies {
  now: () => number
  epoch: () => number
  session: () => string
}

export interface AccountOperation {
  signal: AbortSignal
  isCurrent: () => boolean
  pageIsCurrent: () => boolean
}

export interface AccountFlow {
  pending: () => PendingAccount | null
  setPending: (receipt: PendingAccountResponse, email: string, requestStartedAt?: number) => void
  pacePending: (seconds: number) => void
  setProof: (proof: CapturedAccountProof) => void
  proof: (kind: CapturedAccountProof['kind']) => string | null
  releaseProof: (kind: CapturedAccountProof['kind']) => CapturedAccountProof | null
  begin: () => AccountOperation
  cancel: () => void
  clear: () => void
  leavePage: (preservePending?: boolean) => void
}

export interface FirstProductHandoffDependencies {
  currentSession: () => { sessionId?: string; canCreate: boolean; epoch: number } | null
}

export interface IFirstProductHandoff {
  offer: (nextAction: string) => void
  consume: () => boolean
}
