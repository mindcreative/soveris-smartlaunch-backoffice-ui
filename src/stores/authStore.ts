import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { AuthUser, UserRole } from '../types/auth'
import { authApi } from '../api/endpoints'
import { hasRolePermission } from '../auth/permissions'
import { clearPrivateBillingQueries } from '../queries/billingQueries'
import { queryClient } from '../queryClient'

interface AuthState {
  accessToken: string | null
  refreshTokenValue: string | null
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  isInitialized: boolean
}

export interface AuthActions {
  setTokens: (accessToken: string, refreshTokenValue: string) => void
  setUser: (user: AuthUser) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  doRefreshToken: () => Promise<void>
  initialize: () => Promise<void>
  clearSession: () => Promise<void>
  handleSuccessfulRefresh: () => Promise<void>
  hasRole: (requiredRole: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasPermission: (permission: string) => boolean
}

type AuthStore = AuthState & AuthActions

const roleHierarchy: Record<UserRole, number> = { Viewer: 0, Editor: 1, Admin: 2 }

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        accessToken: null,
        refreshTokenValue: null,
        user: null,
        isLoading: true,
        isAuthenticated: false,
        isInitialized: false,

        setTokens: (accessToken: string, refreshTokenValue: string) => {
          set({ accessToken, refreshTokenValue, isAuthenticated: !!accessToken, isInitialized: true })
        },

        setUser: (user: AuthUser) => {
          set({ user, isAuthenticated: true, isInitialized: true })
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
          return hasRolePermission(state.user.role, permission)
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
              isInitialized: true,
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
            set({ isLoading: false, isAuthenticated: false, isInitialized: true })
            throw new Error(message)
          }
        },

        logout: async () => {
          // NOTE: API /auth/logout and /auth/revoke are not called from the UI side.
          // Simply clear local state.
          set({
            user: null,
            accessToken: null,
            refreshTokenValue: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
          })

          await clearPrivateBillingQueries(queryClient)

          try {
            localStorage.removeItem('backoffice_access_token')
            localStorage.removeItem('backoffice_refresh_token')
          }
          catch {
            // noop
          }
        },

        clearSession: async () => {
          await get().logout()
        },

        handleSuccessfulRefresh: async () => {
          await clearPrivateBillingQueries(queryClient)
        },

        doRefreshToken: async () => {
          const state = get()
          if (!state.refreshTokenValue) {
            set({
              isAuthenticated: false,
              user: null,
              accessToken: null,
              refreshTokenValue: null,
              isLoading: false,
              isInitialized: true,
            })
            await clearPrivateBillingQueries(queryClient)
            return
          }

          set({ isLoading: true })
          try {
            const result = await authApi.refreshToken({ refreshToken: state.refreshTokenValue })

            await clearPrivateBillingQueries(queryClient)

            set({
              accessToken: result.accessToken,
              refreshTokenValue: result.refreshToken,
              isLoading: false,
              isAuthenticated: true,
              isInitialized: true,
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
              isInitialized: true,
            })

            await clearPrivateBillingQueries(queryClient)

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
          if (state.isInitialized) return
          if (!state.accessToken) {
            set({ isLoading: false, isAuthenticated: false, isInitialized: true })
            return
          }

          // NOTE: /auth/me is not implemented in the API.
          // Trust the persisted JWT payload (user + expiration) and attempt refresh if needed.
          set({ isLoading: false })
          try {
            // If we have a persisted user with accessToken, consider authenticated
            if (state.user && state.accessToken) {
              set({ isAuthenticated: true, isLoading: false, isInitialized: true })
            } else if (state.refreshTokenValue) {
              await get().doRefreshToken()
            } else {
              set({
                user: null,
                accessToken: null,
                refreshTokenValue: null,
                isAuthenticated: false,
                isLoading: false,
                isInitialized: true,
              })
            }
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
                isInitialized: true,
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
