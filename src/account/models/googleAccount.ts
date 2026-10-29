import type { AuthResponse } from '../../types/auth'
import type { PendingAccountResponse } from './accountLifecycle'

export type GoogleIntent = 'signup' | 'login' | 'link' | 'resume_verification'
export type GoogleCompletion =
  | { status: 'authenticated'; session: AuthResponse }
  | { status: 'activated'; session: AuthResponse; nextAction: 'create_first_product' }
  | (PendingAccountResponse & { authMethod: 'google' })
  | { status: 'link_required' | 'signup_required' | 'cancelled' }
  | { status: 'login_required'; loginRequired: true }

export interface GoogleContext {
  csrf: string
  expiresIn: number
  enabled: true
}

export interface GoogleStart {
  authorizationUrl: string
  expiresIn: number
}
