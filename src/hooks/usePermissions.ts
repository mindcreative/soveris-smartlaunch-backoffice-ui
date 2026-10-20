import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types/auth'

export interface UsePermissionsReturn {
  hasRole: (role: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasAllRoles: (roles: UserRole[]) => boolean
  canWrite: boolean
  canManageUsers: boolean
  canAccessSettings: boolean
  canAccessProducts: boolean
  canAccessAnalytics: boolean
  canAccessSubmissions: boolean
}

export function usePermissions(): UsePermissionsReturn {
  const current = useAuthStore(s => s.user)
  const has = useAuthStore(s => s.hasPermission)
  const hasRole = (role: UserRole) => current?.role === role
  const hasAnyRole = (roles: UserRole[]) => Boolean(current && roles.includes(current.role))
  return { hasRole,hasAnyRole,hasAllRoles: roles => roles.every(hasRole),
    canWrite: has('products:update'),canManageUsers: has('users:view'),canAccessSettings: has('clients:update'),
    canAccessProducts: has('products:view'),canAccessAnalytics: has('analytics:view'),canAccessSubmissions: has('submissions:view') }
}
