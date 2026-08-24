import { createContext, useContext, useEffect, ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'
import { hasAnyRolePermission, hasRolePermission } from '../auth/permissions'
import type { AuthRefreshLifecycleDetail } from '../api/apiClient'

// AuthContext for backward compatibility with App.tsx AuthProvider
const AuthContext = createContext<ReturnType<typeof useAuth> | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()

  useEffect(() => {
    void useAuthStore.getState().initialize()
  }, [])

  useEffect(() => {
    const handleAuthRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<AuthRefreshLifecycleDetail>).detail
      detail.waitUntil(useAuthStore.getState().handleSuccessfulRefresh())
    }
    window.addEventListener('auth:refreshed', handleAuthRefreshed)
    return () => window.removeEventListener('auth:refreshed', handleAuthRefreshed)
  }, [])

  useEffect(() => {
    const handleAuthCleared = () => {
      void useAuthStore.getState().clearSession()
    }
    window.addEventListener('auth:cleared', handleAuthCleared)
    return () => window.removeEventListener('auth:cleared', handleAuthCleared)
  }, [])

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
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const refreshTokenAction = useAuthStore((s) => s.doRefreshToken)

  const hasPermission = (permission: string): boolean => {
    return hasRolePermission(user?.role, permission)
  }

  const hasAnyPermission = (permissions: string[]): boolean => {
    return hasAnyRolePermission(user?.role, permissions)
  }

  return {
    accessToken,
    refreshTokenValue,
    refreshToken: refreshTokenAction,
    user,
    isLoading,
    isInitialized,
    isAuthenticated,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
  }
}
