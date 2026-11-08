import type { MfaProjection } from '../account/models/mfa'

export type UserRole = 'ClientOwner' | 'ClientAdmin' | 'Editor' | 'Viewer'

export interface AuthUser extends Partial<MfaProjection> {
  id: string
  email: string
  displayName: string
  workspaceName?: string | null
  role: UserRole
  clientRoleId?: string
  securityRevision?: string
  sessionId?: string
  timeZoneId?: string | null
  permissions?: readonly string[]
  platformPermissions?: readonly string[]
  clientId: string
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RefreshTokenRequest {
  refreshToken: string
}

export interface AuthResponse {
  user?: AuthUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}
