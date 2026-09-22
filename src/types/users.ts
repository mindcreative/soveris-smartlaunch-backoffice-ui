import type { LocalInstantValue } from '../timezone/LocalInstant'

export interface BackOfficeUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  isActive: boolean
  createdAt: LocalInstantValue
  updatedAt: LocalInstantValue
  clientId: string
  timeZoneId: string
}

export type BackOfficeUserDetail = Pick<BackOfficeUser,
  'id' | 'email' | 'displayName' | 'role' | 'isActive' | 'createdAt'>
export type CreatedBackOfficeUser = Pick<BackOfficeUser,
  'id' | 'email' | 'displayName' | 'role' | 'timeZoneId'>
export interface UpdatedBackOfficeUser { message: string }

export type UserRole = 'Admin' | 'Editor' | 'Viewer'

export interface CreateUserRequest {
  email: string
  password: string
  displayName: string
  role: UserRole
  timeZoneId: string
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
  createdAt: LocalInstantValue
}
