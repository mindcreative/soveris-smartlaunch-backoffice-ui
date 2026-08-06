import { createContext, useContext, ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'

// Role-based permission map
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'users:view', 'users:create', 'users:edit', 'users:delete',
    'content:view', 'content:create', 'content:edit', 'content:delete',
    'submissions:view', 'submissions:approve', 'submissions:reject',
    'analytics:view', 'audit:view',
    'ai:view', 'ai:use',
    'settings:view', 'settings:edit',
    'themes:view', 'themes:edit',
  ],
  editor: [
    'content:view', 'content:create', 'content:edit', 'content:delete',
    'submissions:view', 'submissions:approve', 'submissions:reject',
    'analytics:view',
    'ai:view', 'ai:use',
  ],
  viewer: [
    'content:view',
    'submissions:view',
    'analytics:view',
    'audit:view',
    'ai:view',
    'settings:view',
    'themes:view',
  ],
}

// AuthContext for backward compatibility with App.tsx AuthProvider
const AuthContext = createContext<ReturnType<typeof useAuth> | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}

export function useAuth() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshTokenValue = useAuthStore((s) => s.refreshTokenValue)
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const refreshTokenAction = useAuthStore((s) => s.doRefreshToken)

  const hasPermission = (permission: string): boolean => {
    if (!user?.role) return false
    // Normalize role to lowercase for lookup (DB stores "Admin", map uses "admin")
    const normalizedRole = user.role.toLowerCase()
    const allowed = ROLE_PERMISSIONS[normalizedRole]
    if (!allowed) return false
    return allowed.includes(permission)
  }

  const hasAnyPermission = (permissions: string[]): boolean => {
    if (!user?.role) return false
    // Normalize role to lowercase for lookup (DB stores "Admin", map uses "admin")
    const normalizedRole = user.role.toLowerCase()
    const allowed = ROLE_PERMISSIONS[normalizedRole]
    if (!allowed) return false
    return permissions.some((p) => allowed.includes(p))
  }

  return {
    accessToken,
    refreshTokenValue,
    refreshToken: refreshTokenAction,
    user,
    isLoading,
    isAuthenticated,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
  }
}
