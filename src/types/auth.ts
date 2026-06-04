export type UserRole = 'Admin' | 'Editor' | 'Viewer'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  role: UserRole
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
  accessToken: string
  refreshToken: string
  expiresIn: number
}