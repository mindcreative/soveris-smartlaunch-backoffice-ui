import { hasMfaAssurance } from '../auth/mfaAuthority'
import { createContext, useContext, useEffect, ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'
import { hasAnyPermission as projectedAny, hasPermission as projected } from '../auth/permissions'
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
      const pending=useAuthStore.getState().handleSuccessfulRefresh()
      if(detail?.waitUntil) detail.waitUntil(pending)
      else void pending.catch(() => useAuthStore.getState().suspendAuthority())
    }
    window.addEventListener('auth:refreshed', handleAuthRefreshed)
    return () => window.removeEventListener('auth:refreshed', handleAuthRefreshed)
  }, [])

  useEffect(() => {
    const revalidate = (event: Event) => {
      const detail = (event as CustomEvent<AuthRefreshLifecycleDetail>).detail
      const pending=useAuthStore.getState().revalidateAuthority()
      const guarded=pending.catch(() => useAuthStore.getState().suspendAuthority())
      if(detail?.waitUntil) detail.waitUntil(guarded)
      else void guarded
    }
    window.addEventListener('auth:forbidden', revalidate)
    return () => window.removeEventListener('auth:forbidden', revalidate)
  }, [])

  useEffect(() => {
    const synchronize = () => { void useAuthStore.getState().synchronizeSessionFromStorage() }
    const storage = (event: StorageEvent) => {
      if(event.storageArea && event.storageArea!==localStorage) return
      if(event.key===null || event.key==='backoffice_access_token' || event.key==='backoffice_refresh_token' || event.key==='backoffice-auth-persist') synchronize()
    }
    window.addEventListener('storage',storage)
    window.addEventListener('auth:storage-changed',synchronize)
    const verifyCurrent = () => {
      const state = useAuthStore.getState()

      if (state.user?.assuranceGeneration && !hasMfaAssurance(state.user)) {
        state.retirePrivileged()
      }

      void state.synchronizeSessionFromStorage().then(() => useAuthStore.getState().revalidateAuthority())
        .catch(() => useAuthStore.getState().suspendAuthority())
    }
    // An unchanged JWT cannot preserve expired or revoked platform assurance.
    window.addEventListener('pageshow',verifyCurrent)
    window.addEventListener('focus',verifyCurrent)
    return () => {
      window.removeEventListener('storage',storage)
      window.removeEventListener('auth:storage-changed',synchronize)
      window.removeEventListener('pageshow',verifyCurrent)
      window.removeEventListener('focus',verifyCurrent)
    }
  }, [])

  useEffect(() => {
    const handleAuthCleared = () => {
      void useAuthStore.getState().clearSession()
    }
    const suspend = () => { void useAuthStore.getState().suspendAuthority() }
    window.addEventListener('auth:suspended', suspend)
    window.addEventListener('auth:cleared', handleAuthCleared)
    return () => { window.removeEventListener('auth:cleared', handleAuthCleared);window.removeEventListener('auth:suspended', suspend) }
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
    return isAuthenticated && projected(user, permission)
  }

  const hasAnyPermission = (permissions: string[]): boolean => {
    return isAuthenticated && projectedAny(user, permissions)
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
