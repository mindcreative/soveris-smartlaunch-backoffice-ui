import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types/auth'

export interface UseAuthGuardOptions {
  requiredRole?: UserRole
  requiredPermission?: string
  isAuthenticatedOnly?: boolean
}

export function useAuthGuard(options: UseAuthGuardOptions = {}) {
  const { requiredRole,requiredPermission, isAuthenticatedOnly } = options
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasPermission = useAuthStore(s => s.hasPermission)
  const currentRole = useAuthStore((s) => s.user?.role)
  const navigate = useNavigate()
  const location = useLocation()

  const hasAccess = useCallback((): boolean => {
    // Must be authenticated first
    if (!isAuthenticated) return false

    // If only auth is required, grant access
    if (isAuthenticatedOnly) return true

    if(requiredPermission) return hasPermission(requiredPermission)
    if(requiredRole) return currentRole===requiredRole

    return false
  }, [isAuthenticated, isAuthenticatedOnly, requiredRole, currentRole, requiredPermission,hasPermission])

  const guardWithRedirect = useCallback(
    (fallbackPath = '/login') => {
      if (!hasAccess()) {
        navigate(fallbackPath, { state: { from: location.pathname } })
        return false
      }
      return true
    },
    [hasAccess, navigate, location.pathname]
  )

  return { hasAccess, guardWithRedirect }
}