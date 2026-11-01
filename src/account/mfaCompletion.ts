import { currentAuthorityEpoch } from '../auth/authorityEpoch'
import { useAuthStore } from '../stores/authStore'
import { MFA_ROUTES } from './constants/mfa'
import { mfaFlow } from './mfaFlow'
import type { MfaOperation } from './models/mfa'

export async function showMfaCodes(codes: readonly string[], operation: MfaOperation): Promise<boolean> {
  if (!operation.isCurrent()) {
    return false
  }

  const retiring = useAuthStore.getState().clearSession()
  const epoch = currentAuthorityEpoch()
  await retiring

  try {
    if (currentAuthorityEpoch() !== epoch || useAuthStore.getState().accessToken || localStorage.getItem('backoffice_access_token')
      || localStorage.getItem('backoffice_refresh_token') || !operation.pageIsCurrent()) {
      return false
    }
  } catch {
    return false
  }

  mfaFlow.setCodes(codes)
  mfaFlow.offerHandoff(MFA_ROUTES.enroll)

  return true
}
