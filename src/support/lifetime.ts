import { retireAuthority } from '../auth/authorityEpoch'
import { queryClient } from '../queryClient'
import type { AuthUser } from '../types/auth'
import { bindExperienceScope } from '../auth/experienceScope'
import { supportAuthority, supportScopeKey } from './authority'
import { SUPPORT } from './constants'
import type { SupportContext, SupportNotice } from './models'

// Negative exit intent only; no grant or customer content is persisted.
const exitedGrants = new Set<string>()
export function locallyExited(grant: string): boolean { return exitedGrants.has(grant) }

export function exitSupportLocally(grant: string): void {
  exitedGrants.add(grant)
  retireSupport({ status: 0, message: 'Support data cleared. Ending access; server confirmation is pending.', retryAt: Date.now() + SUPPORT.deadlineMilliseconds })
  notifySupportPeers()
}

export function adoptSupportContext(context: SupportContext, actor: AuthUser): void {
  if (locallyExited(context.id)) {
    throw new Error('This support view was ended locally. Verify its terminal state from the request list.')
  }

  bindExperienceScope(supportScopeKey(context, actor), queryClient)
  supportAuthority.bind(context, actor)
}

export function retireSupport(notice?: SupportNotice): void {
  supportAuthority.retire(notice)
  retireAuthority()
  const cancellation = queryClient.cancelQueries()
  queryClient.removeQueries()
  queryClient.getMutationCache().clear()
  void cancellation.catch(() => undefined)
  window.dispatchEvent(new CustomEvent(SUPPORT.retiredEvent))
}

export function notifySupportPeers(): void {
  window.dispatchEvent(new CustomEvent(SUPPORT.peerEvent))
}
