import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { AuthResponse, AuthUser, UserRole } from '../types/auth'
import { authApi } from '../api/endpoints'
import { hasPermission } from '../auth/permissions'
import { parseCurrentAuthority } from '../auth/currentAuthority'
import { bindAuthorityToken, currentAuthorityEpoch, retireAuthority } from '../auth/authorityEpoch'
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

type StoredTokenSnapshot =
  | { available: true; accessToken: string | null; refreshToken: string | null }
  | { available: false }

function storedTokenSnapshot(): StoredTokenSnapshot {
  try {
    return {
      available: true,
      accessToken: localStorage.getItem('backoffice_access_token'),
      refreshToken: localStorage.getItem('backoffice_refresh_token'),
    }
  } catch {
    return { available: false }
  }
}

function sameStoredTokens(left: StoredTokenSnapshot, right: StoredTokenSnapshot): boolean {
  if (left.available !== right.available) {
    return false
  }

  if (!left.available || !right.available) {
    return true
  }

  return left.accessToken === right.accessToken && left.refreshToken === right.refreshToken
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
  login: (email: string, password: string, signal?: AbortSignal) => Promise<boolean>
  acceptActivationSession: (session: AuthResponse, expectedEpoch: number, signal?: AbortSignal) => Promise<boolean>
  logout: () => Promise<void>
  doRefreshToken: () => Promise<void>
  initialize: () => Promise<void>
  clearSession: () => Promise<void>
  suspendAuthority: () => Promise<void>
  revalidateAuthority: () => Promise<void>
  handleSuccessfulRefresh: () => Promise<void>
  synchronizeSessionFromStorage: () => Promise<void>
  hasRole: (role: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  hasPermission: (permission: string) => boolean
}
type AuthStore = AuthState & AuthActions
const anonymous = { user: null, accessToken: null, refreshTokenValue: null, isAuthenticated: false, isLoading: false, isInitialized: true, authorityUnavailable: false }
let initializing: Promise<void> | null = null
let refreshingProjection: Promise<void> | null = null
let revalidatingProjection: Promise<void> | null = null
function sameAuthority(left: AuthUser | null, right: AuthUser): boolean {
  return Boolean(left && left.id===right.id && left.clientId===right.clientId && left.clientRoleId===right.clientRoleId &&
    left.sessionId===right.sessionId && left.securityRevision===right.securityRevision && left.role===right.role &&
    JSON.stringify(left.permissions??[])===JSON.stringify(right.permissions??[]) &&
    JSON.stringify(left.platformPermissions??[])===JSON.stringify(right.platformPermissions??[]))
}
export const useAuthStore = create<AuthStore>()(devtools(persist((set, get) => {
  function accept(user: unknown, access: string, refresh: string): void {
    const parsed = parseCurrentAuthority(user)
    void clearPrivateState()
    tokens(access, refresh)
    bindAuthorityToken(access)
    set({ user: { ...parsed, accessToken: access, refreshToken: refresh }, accessToken: access,
      refreshTokenValue: refresh, isAuthenticated: true, isInitialized: true, isLoading: false, authorityUnavailable: false })
  }
  async function clear(): Promise<void> {
    bindAuthorityToken(null)
    set(anonymous); tokens(null, null); await clearPrivateState()
  }
  return {
    ...anonymous, isLoading: true, isInitialized: false,
    setTokens: (access, refresh) => { tokens(access, refresh); set({ accessToken: access, refreshTokenValue: refresh }) },
    setUser: user => { const s=get(); if (!s.accessToken || !s.refreshTokenValue) return; accept(user,s.accessToken,s.refreshTokenValue) },
    hasRole: role => get().isAuthenticated && get().user?.role === role,
    hasAnyRole: roles => get().isAuthenticated && Boolean(get().user && roles.includes(get().user!.role)),
    hasPermission: permission => get().isAuthenticated && hasPermission(get().user,permission),
    login: async (email, password, signal) => {
      const retiring = clear()
      const epoch = currentAuthorityEpoch()
      await retiring

      if (currentAuthorityEpoch() !== epoch || signal?.aborted) {
        return false
      }

      const initialTokens = storedTokenSnapshot()

      if (initialTokens.available && (initialTokens.accessToken || initialTokens.refreshToken)) {
        return false
      }

      set({ isLoading: true })

      try {
        const result = await authApi.login({ email, password }, signal)

        if (currentAuthorityEpoch() !== epoch || !sameStoredTokens(initialTokens, storedTokenSnapshot())) {
          return false
        }

        if (signal?.aborted) {
          set({ isLoading: false })

          return false
        }

        accept(result.user, result.accessToken, result.refreshToken)

        return true
      } catch (error) {
        if (signal?.aborted) {
          if (currentAuthorityEpoch() === epoch && sameStoredTokens(initialTokens, storedTokenSnapshot())) {
            set({ isLoading: false })
          }

          return false
        }

        if (currentAuthorityEpoch() === epoch && sameStoredTokens(initialTokens, storedTokenSnapshot())) {
          await clear()
        }

        throw error
      }
    },
    acceptActivationSession: async (session, expectedEpoch, signal) => {
      if (currentAuthorityEpoch() !== expectedEpoch || get().accessToken || get().isAuthenticated || signal?.aborted) {
        return false
      }

      const activation = parseCurrentAuthority(session.user)
      const access = session.accessToken
      const refresh = session.refreshToken

      if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) {
        throw { code: 'account_flow_unavailable', loginRequired: true }
      }

      try {
        if (localStorage.getItem('backoffice_access_token') || localStorage.getItem('backoffice_refresh_token')) {
          return false
        }
      } catch {
        throw { code: 'account_flow_unavailable', loginRequired: true }
      }

      tokens(access, refresh)
      bindAuthorityToken(null)
      set({ accessToken: access, refreshTokenValue: refresh, user: null, isAuthenticated: false, isLoading: true })
      const installedTokens: StoredTokenSnapshot = { available: true, accessToken: access, refreshToken: refresh }
      const ownsAcceptance = () => currentAuthorityEpoch() === expectedEpoch && get().accessToken === access &&
        get().refreshTokenValue === refresh && sameStoredTokens(installedTokens, storedTokenSnapshot())

      try {
        const current = parseCurrentAuthority(await authApi.currentAuthority())

        if (!ownsAcceptance()) {
          return false
        }

        if (signal?.aborted) {
          await clear()

          return false
        }

        const sameSession = current.id === activation.id && current.clientId === activation.clientId &&
          current.sessionId === activation.sessionId && current.securityRevision === activation.securityRevision

        if (!sameSession) {
          throw { code: 'account_flow_unavailable', loginRequired: true }
        }

        accept(current, access, refresh)

        return true
      } catch {
        if (!ownsAcceptance()) {
          return false
        }

        await clear()
        throw { code: 'account_flow_unavailable', loginRequired: true }
      }
    },
    logout: async () => {
      const refresh=get().refreshTokenValue
      await clear()
      if (refresh) { try { await authApi.revoke(refresh) } catch { /* Local scope stays retired; server denial/unavailability is not success. */ } }
    },
    clearSession: clear,
    suspendAuthority: async () => {
      bindAuthorityToken(null)
      set({ user: null,isAuthenticated: false,isLoading: false,isInitialized: true,authorityUnavailable: true })
      await clearPrivateState()
    },
    synchronizeSessionFromStorage: async () => {
      let access: string | null = null, refresh: string | null = null
      try { access=localStorage.getItem('backoffice_access_token');refresh=localStorage.getItem('backoffice_refresh_token') } catch { /* Retire unverifiable storage. */ }
      if(access===get().accessToken && refresh===get().refreshTokenValue) return
      // Retire synchronously, before the first await. Do not write shared tokens:
      // an intermediate logout/rotation event must not erase another tab's login.
      bindAuthorityToken(null)
      set({ ...anonymous,accessToken:access,refreshTokenValue:refresh,isLoading:Boolean(access && refresh) })
      const retiring=clearPrivateState(), epoch=currentAuthorityEpoch()
      await retiring
      if(!access || !refresh || currentAuthorityEpoch()!==epoch) return
      try {
        const projection=await authApi.currentAuthority()
        if(currentAuthorityEpoch()!==epoch || localStorage.getItem('backoffice_access_token')!==access ||
          localStorage.getItem('backoffice_refresh_token')!==refresh) return
        accept(projection,access,refresh)
      } catch (error) {
        if(currentAuthorityEpoch()!==epoch) return
        const denied=error && typeof error==='object' && 'status' in error && (error.status===401 || error.status===403)
        set({user:null,isAuthenticated:false,isLoading:false,authorityUnavailable:!denied})
      }
    },
    revalidateAuthority: async () => {
      if(revalidatingProjection) return revalidatingProjection
      revalidatingProjection=(async () => {
        const state=get()
        if(!state.isAuthenticated || !state.user || !state.accessToken || !state.refreshTokenValue) return
        const epoch=currentAuthorityEpoch()
        try {
          const parsed=parseCurrentAuthority(await authApi.currentAuthority())
          if(currentAuthorityEpoch()!==epoch || sameAuthority(get().user,parsed)) return
          accept(parsed,state.accessToken,state.refreshTokenValue)
        } catch(error) {
          if(currentAuthorityEpoch()!==epoch) return
          if(error && typeof error==='object' && 'status' in error && error.status===503) await get().suspendAuthority()
          else if(error && typeof error==='object' && 'status' in error && (error.status===401 || error.status===403)) await clear()
          else throw error
        }
      })()
      try {await revalidatingProjection} finally {revalidatingProjection=null}
    },
    handleSuccessfulRefresh: async () => {
      if (refreshingProjection) return refreshingProjection
      refreshingProjection=(async () => {
        const retiring=get().suspendAuthority(),epoch=currentAuthorityEpoch()
        await retiring
        if(currentAuthorityEpoch()!==epoch) return
        let access: string | null=null, refresh: string | null=null
        try { access=localStorage.getItem('backoffice_access_token');refresh=localStorage.getItem('backoffice_refresh_token') } catch { /* handled below */ }
        if(!access || !refresh) { await clear();return }
        const projection=await authApi.currentAuthority()
        if(currentAuthorityEpoch()!==epoch) return
        accept(projection,access,refresh)
      })()
      try { await refreshingProjection } finally { refreshingProjection=null }
    },
    doRefreshToken: async () => {
      const refresh=get().refreshTokenValue
      if(!refresh) { await clear();return }
      const retiring=get().suspendAuthority(),epoch=currentAuthorityEpoch()
      await retiring
      if(currentAuthorityEpoch()!==epoch) return
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
        let access: string | null=null,refresh: string | null=null
        try { access=localStorage.getItem('backoffice_access_token');refresh=localStorage.getItem('backoffice_refresh_token') } catch { /* handled below */ }
        if(!access || !refresh) { await clear();return }
        bindAuthorityToken(null)
        set({ user: null,accessToken:access,refreshTokenValue:refresh,isAuthenticated: false,isLoading: true })
        const retiring=clearPrivateState(),epoch=currentAuthorityEpoch()
        await retiring
        if(currentAuthorityEpoch()!==epoch) return
        try {
          const projection=await authApi.currentAuthority()
          if(currentAuthorityEpoch()===epoch) accept(projection,access,refresh)
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
