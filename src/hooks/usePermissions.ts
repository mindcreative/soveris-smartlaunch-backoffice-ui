import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types/auth'

export interface UsePermissionsReturn {
  hasRole: (role: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasAllRoles: (roles: UserRole[]) => boolean
  canWrite: boolean
  canManageUsers: boolean
  canAccessSettings: boolean
  canAccessContent: boolean
  canAccessAnalytics: boolean
  canAccessSubmissions: boolean
}

const roleHierarchy: Record<UserRole, number> = { Viewer: 0, Editor: 1, Admin: 2 }

export function usePermissions(): UsePermissionsReturn {
  const currentRole = useAuthStore((s) => s.user?.role) ?? 'Viewer'

  const hasRole = (role: UserRole): boolean => {
    return roleHierarchy[currentRole] >= roleHierarchy[role]
  }

  const hasAnyRole = (roles: UserRole[]): boolean => {
    return roles.includes(currentRole)
  }

  const hasAllRoles = (roles: UserRole[]): boolean => {
    return roles.every((r) => hasRole(r))
  }

  const canWrite = hasRole('Editor')
  const canManageUsers = hasRole('Admin')
  const canAccessSettings = hasRole('Admin')
  const canAccessContent = hasRole('Viewer')
  const canAccessAnalytics = hasRole('Viewer')
  const canAccessSubmissions = hasRole('Viewer')

  return {
    hasRole,
    hasAnyRole,
    hasAllRoles,
    canWrite,
    canManageUsers,
    canAccessSettings,
    canAccessContent,
    canAccessAnalytics,
    canAccessSubmissions,
  }
}