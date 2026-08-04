import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { AuthUser, UserRole } from '../types/auth'
import { authApi } from '../api/endpoints'

interface AuthState {
  accessToken: string | null
  refreshTokenValue: string | null
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
}

export interface AuthActions {
  setTokens: (accessToken: string, refreshTokenValue: string) => void
  setUser: (user: AuthUser) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  doRefreshToken: () => Promise<void>
  initialize: () => Promise<void>
  hasRole: (requiredRole: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasPermission: (permission: string) => boolean
}

type AuthStore = AuthState & AuthActions

const roleHierarchy: Record<UserRole, number> = { Viewer: 0, Editor: 1, Admin: 2 }

// Permission matrix per role
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  Admin: [
    'dashboard:view',
    'submissions:view',
    'submissions:edit',
    'submissions:delete',
    'content:view',
    'content:create',
    'content:edit',
    'content:delete',
    'users:view',
    'users:create',
    'users:edit',
    'users:delete',
    'clients:view',
    'clients:create',
    'clients:edit',
    'clients:delete',
    'analytics:view',
    'ai:use',
    'audit:view',
    'settings:view',
    'settings:edit',
    'theme:view',
    'theme:edit',
  ],
  Editor: [
    'dashboard:view',
    'submissions:view',
    'submissions:edit',
    'content:view',
    'content:create',
    'content:edit',
    'analytics:view',
    'ai:use',
  ],
  Viewer: [
    'dashboard:view',
    'submissions:view',
    'content:view',
    'analytics:view',
    'audit:view',
  ],
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        accessToken: null,
        refreshTokenValue: null,
        user: null,
        isLoading: false,
        isAuthenticated: false,

        setTokens: (accessToken: string, refreshTokenValue: string) => {
          set({ accessToken, refreshTokenValue, isAuthenticated: !!accessToken })
        },

        setUser: (user: AuthUser) => {
          set({ user, isAuthenticated: true })
        },

        hasRole: (requiredRole: UserRole) => {
          const state = get()
          if (!state.user) return false
          return roleHierarchy[state.user.role] >= roleHierarchy[requiredRole]
        },

        hasAnyRole: (roles: UserRole[]) => {
          const state = get()
          if (!state.user) return false
          return roles.includes(state.user.role)
        },

        hasPermission: (permission: string) => {
          const state = get()
          if (!state.user) return false
          const permissions = ROLE_PERMISSIONS[state.user.role]
          return permissions.includes(permission)
        },

        login: async (email: string, password: string) => {
          set({ isLoading: true })
          try {
            const result = await authApi.login({ email, password })
            const fullUser: AuthUser = {
              id: result.user?.id || '',
              email,
              displayName: result.user?.displayName || email,
              role: result.user?.role || 'Viewer',
              clientId: result.user?.clientId || '',
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
              expiresIn: result.expiresIn,
            }

            set({
              user: fullUser,
              accessToken: result.accessToken,
              refreshTokenValue: result.refreshToken,
              isAuthenticated: true,
              isLoading: false,
            })

            // Also persist in localStorage for interceptor
            try {
              localStorage.setItem('backoffice_access_token', result.accessToken)
              localStorage.setItem('backoffice_refresh_token', result.refreshToken)
            } catch {
              // localStorage unavailable
            }
          } catch (error) {
            const message =
              error && typeof error === 'object' && 'message' in error
                ? (error as { message: string }).message
                : 'Login failed'
            set({ isLoading: false, isAuthenticated: false })
            throw new Error(message)
          }
        },

        logout: async () => {
          try {
            await authApi.logout()
          } catch {
            // Ignore logout errors — clear state regardless
          } finally {
            set({
              user: null,
              accessToken: null,
              refreshTokenValue: null,
              isAuthenticated: false,
              isLoading: false,
            })

            try {
              localStorage.removeItem('backoffice_access_token')
              localStorage.removeItem('backoffice_refresh_token')
            } catch {
              // noop
            }
          }
        },

        doRefreshToken: async () => {
          const state = get()
          if (!state.refreshTokenValue) {
            set({ isAuthenticated: false, user: null, accessToken: null, refreshTokenValue: null })
            return
          }

          set({ isLoading: true })
          try {
            const result = await authApi.refreshToken({ refreshToken: state.refreshTokenValue })

            set({
              accessToken: result.accessToken,
              refreshTokenValue: result.refreshToken,
              isLoading: false,
            })

            try {
              localStorage.setItem('backoffice_access_token', result.accessToken)
              localStorage.setItem('backoffice_refresh_token', result.refreshToken)
            } catch {
              // noop
            }
          } catch {
            set({
              user: null,
              accessToken: null,
              refreshTokenValue: null,
              isAuthenticated: false,
              isLoading: false,
            })

            try {
              localStorage.removeItem('backoffice_access_token')
              localStorage.removeItem('backoffice_refresh_token')
            } catch {
              // noop
            }
          }
        },

        initialize: async () => {
          const state = get()
          if (!state.accessToken) return

          set({ isLoading: true })
          try {
            const user = await authApi.getCurrentUser()
            set({
              user,
              isAuthenticated: true,
              isLoading: false,
            })
          } catch {
            // Token is stale — attempt refresh
            const currentState = get()
            if (currentState.refreshTokenValue) {
              await get().doRefreshToken()
            } else {
              set({
                user: null,
                accessToken: null,
                refreshTokenValue: null,
                isAuthenticated: false,
                isLoading: false,
              })
            }
          }
        },
      }),
      {
        name: 'backoffice-auth-persist',
        partialize: (state) => ({
          accessToken: state.accessToken,
          refreshTokenValue: state.refreshTokenValue,
          user: state.user,
        }),
      }
    ),
    { name: 'BackofficeAuthStore' }
  )
)