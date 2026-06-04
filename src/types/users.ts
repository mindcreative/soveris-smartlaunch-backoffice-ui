export interface BackOfficeUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  isActive: boolean
  createdAt: string
  updatedAt: string
  clientId: string
}

export type UserRole = 'Admin' | 'Editor' | 'Viewer'

export interface CreateUserRequest {
  email: string
  password: string
  displayName: string
  role: UserRole
}

export interface UpdateUserRequest {
  displayName?: string
  role?: UserRole
  isActive?: boolean
}

export interface ResetPasswordRequest {
  newPassword: string
}

export interface UserAuditLog {
  id: string
  action: string
  entityType: string
  entityId?: string
  ipAddress?: string
  userAgent?: string
  createdAt: string
}