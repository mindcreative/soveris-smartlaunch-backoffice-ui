import { authorityTokenIsCurrent, currentAuthorityEpoch } from '../auth/authorityEpoch'
import { currentPrivilegedGeneration } from '../auth/mfaAuthority'
import { useAuthStore } from '../stores/authStore'
import { createSupportApi } from './api'
import { supportAuthority } from './authority'
import { SupportAccessError } from './errors'
import { retireSupport } from './lifetime'

function storedToken(): string | null {
  try {
    return localStorage.getItem('backoffice_access_token')
  } catch {
    return null
  }
}

function actorKey(): string {
  const user = useAuthStore.getState().user
  return JSON.stringify([user?.id, user?.clientId, user?.clientRoleId, user?.sessionId, user?.securityRevision, user?.assuranceGeneration])
}

export const supportApi = createSupportApi({
  capture: () => {
    const state = useAuthStore.getState()
    const accessToken = state.accessToken

    if (!state.isAuthenticated || !state.user || !accessToken || storedToken() !== accessToken || !authorityTokenIsCurrent(accessToken)) {
      throw new SupportAccessError(401)
    }

    const authority = actorKey()
    const epoch = currentAuthorityEpoch()
    const privileged = currentPrivilegedGeneration()
    const support = supportAuthority.capture()
    return { accessToken, isCurrent: () => support.isCurrent() && currentAuthorityEpoch() === epoch && currentPrivilegedGeneration() === privileged &&
      useAuthStore.getState().accessToken === accessToken && storedToken() === accessToken && actorKey() === authority && authorityTokenIsCurrent(accessToken) }
  },
  retire: notice => {
    retireSupport(notice)

    if (notice.status === 403) {
      void useAuthStore.getState().revalidateAuthority()
    }

    if (notice.status === 401) {
      void useAuthStore.getState().clearSession()
    }
  },
})
