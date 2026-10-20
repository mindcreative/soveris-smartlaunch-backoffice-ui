import { useSyncExternalStore } from 'react'
import { useAuthStore } from '../stores/authStore'
import { canonicalizeGuid } from '../lib/guid'

let generation = 0
let authorizationBlocked = false
const listeners = new Set<() => void>()
function identity() {
  const s = useAuthStore.getState()
  return JSON.stringify([s.isAuthenticated, s.user?.id, s.user?.clientId, s.user?.role,s.user?.clientRoleId,s.user?.sessionId,s.user?.securityRevision,s.user?.permissions,s.accessToken])
}
let currentIdentity = identity()
function retire() { generation++; for (const listener of listeners) listener() }
useAuthStore.subscribe(() => {
  const next = identity()
  if (next !== currentIdentity) { currentIdentity = next; authorizationBlocked = false; retire() }
})
if (typeof window !== 'undefined') {
  window.addEventListener('auth:cleared', retire)
  window.addEventListener('auth:refreshed', () => { authorizationBlocked = false; retire() })
  window.addEventListener('popstate', retire)
}
export interface DomainScope { clientId: string; actorId: string; generation: number; blocked?: boolean }
export function captureDomainScope(): DomainScope {
  const s = useAuthStore.getState()
  return { clientId: canonicalizeGuid(s.user?.clientId) ?? '', actorId: canonicalizeGuid(s.user?.id) ?? '', generation, blocked: authorizationBlocked }
}
export function domainScopeCurrent(scope: DomainScope): boolean {
  const current = captureDomainScope()
  return !authorizationBlocked && useAuthStore.getState().isAuthenticated && scope.clientId !== '' && scope.actorId !== '' &&
    current.clientId === scope.clientId && current.actorId === scope.actorId && current.generation === scope.generation
}
export function useDomainScope(): DomainScope {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => generation)
  return captureDomainScope()
}

export function blockDomainAuthority(scope: DomainScope) {
  if (!domainScopeCurrent(scope)) return
  authorizationBlocked = true; retire()
}
