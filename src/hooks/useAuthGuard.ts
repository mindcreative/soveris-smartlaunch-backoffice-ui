import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types/auth'

export interface UseAuthGuardOptions {
  requiredRole?: UserRole
  isAuthenticatedOnly?: boolean
}

export function useAuthGuard(options: UseAuthGuardOptions = {}) {
  const { requiredRole, isAuthenticatedOnly } = options
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const currentRole = useAuthStore((s) => s.user?.role)
  const navigate = useNavigate()
  const location = useLocation()

  const hasAccess = useCallback((): boolean => {
    // Must be authenticated first
    if (!isAuthenticated) return false

    // If only auth is required, grant access
    if (isAuthenticatedOnly) return true

    // If a role is required, check hierarchy
    if (requiredRole && currentRole) {
      const roleHierarchy: Record<UserRole, number> = { Viewer: 0, Editor: 1, Admin: 2 }
      return roleHierarchy[currentRole] >= roleHierarchy[requiredRole]
    }

    return false
  }, [isAuthenticated, isAuthenticatedOnly, requiredRole, currentRole])

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