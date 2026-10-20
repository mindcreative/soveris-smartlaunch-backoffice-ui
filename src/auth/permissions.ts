import type { AuthUser } from '../types/auth'

// Rights are projected by the current server session. Display role names never confer rights.
export function hasPermission(user: Pick<AuthUser, 'permissions' | 'platformPermissions'> | null | undefined, permission: string): boolean {
  if (!permission || permission.includes('*')) return false
  return Boolean(user?.permissions?.includes(permission) || user?.platformPermissions?.includes(permission))
}
export function hasAnyPermission(user: Pick<AuthUser, 'permissions' | 'platformPermissions'> | null | undefined, permissions: readonly string[]): boolean {
  return permissions.some(permission => hasPermission(user, permission))
}
