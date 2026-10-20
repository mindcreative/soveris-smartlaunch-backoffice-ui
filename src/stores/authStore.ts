import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { AuthUser, UserRole } from '../types/auth'
import { authApi } from '../api/endpoints'
import { hasPermission } from '../auth/permissions'
import { parseCurrentAuthority } from '../auth/currentAuthority'
import { currentAuthorityEpoch, retireAuthority } from '../auth/authorityEpoch'
import { clearPrivateClientScope } from '../queries/billingQueries'
import { queryClient } from '../queryClient'

function clearPrivateState(): Promise<void> {
  retireAuthority()
  const retiring = clearPrivateClientScope(queryClient)
  void queryClient.cancelQueries()
  queryClient.clear()
  return retiring
}
function tokens(access: string | null, refresh: string | null): void {
  try {
    if (access) localStorage.setItem('backoffice_access_token', access)
    else localStorage.removeItem('backoffice_access_token')
    if (refresh) localStorage.setItem('backoffice_refresh_token', refresh)
    else localStorage.removeItem('backoffice_refresh_token')
  } catch { /* Storage availability never confers authority. */ }
}
interface AuthState {
  accessToken: string | null
  refreshTokenValue: string | null
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  isInitialized: boolean
  authorityUnavailable: boolean
}
export interface AuthActions {
  setTokens: (access: string, refresh: string) => void
  setUser: (user: AuthUser) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  doRefreshToken: () => Promise<void>
  initialize: () => Promise<void>
  clearSession: () => Promise<void>
  suspendAuthority: () => Promise<void>
  handleSuccessfulRefresh: () => Promise<void>
  hasRole: (role: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasPermission: (permission: string) => boolean
}
type AuthStore = AuthState & AuthActions
const anonymous = { user: null, accessToken: null, refreshTokenValue: null, isAuthenticated: false, isLoading: false, isInitialized: true, authorityUnavailable: false }
let initializing: Promise<void> | null = null
let refreshingProjection: Promise<void> | null = null
export const useAuthStore = create<AuthStore>()(devtools(persist((set, get) => {
  function accept(user: unknown, access: string, refresh: string): void {
    const parsed = parseCurrentAuthority(user)
    void clearPrivateState()
    tokens(access, refresh)
    set({ user: { ...parsed, accessToken: access, refreshToken: refresh }, accessToken: access,
      refreshTokenValue: refresh, isAuthenticated: true, isInitialized: true, isLoading: false, authorityUnavailable: false })
  }
  async function clear(): Promise<void> {
    set(anonymous); tokens(null, null); await clearPrivateState()
  }
  return {
    ...anonymous, isLoading: true, isInitialized: false,
    setTokens: (access, refresh) => { tokens(access, refresh); set({ accessToken: access, refreshTokenValue: refresh }) },
    setUser: user => { const s=get(); if (!s.accessToken || !s.refreshTokenValue) return; accept(user,s.accessToken,s.refreshTokenValue) },
    hasRole: role => get().isAuthenticated && get().user?.role === role,
    hasAnyRole: roles => get().isAuthenticated && Boolean(get().user && roles.includes(get().user!.role)),
    hasPermission: permission => get().isAuthenticated && hasPermission(get().user,permission),
    login: async (email,password) => {
      await clear(); set({ isLoading: true }); const epoch=currentAuthorityEpoch()
      try {
        const result=await authApi.login({ email,password })
        if (currentAuthorityEpoch()!==epoch) return
        accept(result.user,result.accessToken,result.refreshToken)
      } catch (error) { if(currentAuthorityEpoch()===epoch) await clear(); throw error }
    },
    logout: async () => {
      const refresh=get().refreshTokenValue
      await clear()
      if (refresh) { try { await authApi.revoke(refresh) } catch { /* Local scope stays retired; server denial/unavailability is not success. */ } }
    },
    clearSession: clear,
    suspendAuthority: async () => {
      set({ user: null,isAuthenticated: false,isLoading: false,isInitialized: true,authorityUnavailable: true })
      await clearPrivateState()
    },
    handleSuccessfulRefresh: async () => {
      if (refreshingProjection) return refreshingProjection
      refreshingProjection=(async () => {
        await get().suspendAuthority()
        let access: string | null=null, refresh: string | null=null
        try { access=localStorage.getItem('backoffice_access_token');refresh=localStorage.getItem('backoffice_refresh_token') } catch { /* handled below */ }
        if(!access || !refresh) { await clear();return }
        const epoch=currentAuthorityEpoch()
        const projection=await authApi.currentAuthority()
        if(currentAuthorityEpoch()!==epoch) return
        accept(projection,access,refresh)
      })()
      try { await refreshingProjection } finally { refreshingProjection=null }
    },
    doRefreshToken: async () => {
      const refresh=get().refreshTokenValue
      if(!refresh) { await clear();return }
      await get().suspendAuthority();const epoch=currentAuthorityEpoch()
      try {
        const result=await authApi.refreshToken({ refreshToken: refresh })
        if(currentAuthorityEpoch()!==epoch) return
        accept(result.user,result.accessToken,result.refreshToken)
      } catch { if(currentAuthorityEpoch()===epoch) await clear() }
    },
    initialize: async () => {
      if(get().isInitialized) return
      if(initializing) return initializing
      initializing=(async () => {
        const state=get();if(!state.accessToken) { await clear();return }
        tokens(state.accessToken,state.refreshTokenValue)
        set({ user: null,isAuthenticated: false,isLoading: true });await clearPrivateState();const epoch=currentAuthorityEpoch()
        try {
          const projection=await authApi.currentAuthority()
          if(currentAuthorityEpoch()===epoch) accept(projection,state.accessToken,state.refreshTokenValue??'')
        } catch (error) {
          if(currentAuthorityEpoch()!==epoch) return
          if(error && typeof error==='object' && 'status' in error && error.status===503) await get().suspendAuthority()
          else await clear()
        }
      })()
      try { await initializing } finally { initializing=null }
    },
  }
}, {
  name: 'backoffice-auth-persist',version: 2,
  // Legacy role/session payloads must reauthenticate. Persisted user data never grants authority.
  migrate: () => ({ accessToken: null,refreshTokenValue: null }),
  partialize: state => ({ accessToken: state.accessToken, refreshTokenValue: state.refreshTokenValue }),
}), { name: 'BackofficeAuthStore' }))
