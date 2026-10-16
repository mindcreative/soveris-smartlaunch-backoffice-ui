import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { DomainRelease } from '../types/domains'
import type { ApiError } from '../api/apiClient'
import { domainsApi } from '../api/domainsApi'
import { DomainTracker } from './domainTracker'
import { clearPrivateClientScope } from './billingQueries'
import { domainKeys, assertDomainScope } from './domainQueries'
import { blockDomainAuthority, domainScopeCurrent, type DomainScope } from './domainScope'

interface Entry { tracker: DomainTracker; owners: number; teardown: ReturnType<typeof setTimeout> | null }
const registries = new WeakMap<QueryClient, Map<string, Entry>>()
function entry(client: QueryClient, scope: DomainScope, id: string): Entry {
  let registry = registries.get(client)
  if (!registry) { registry = new Map(); registries.set(client, registry) }
  const key = JSON.stringify(domainKeys.lookup(scope, id))
  let value = registry.get(key)
  if (!value) {
    value = { owners: 0, teardown: null, tracker: new DomainTracker({
      current: () => domainScopeCurrent(scope),
      read: async (signal, additionalRequest) => {
        assertDomainScope(scope, signal)
        const retained = client.getQueryData<DomainRelease>(domainKeys.receipt(scope, id))
        if (!retained) {
          try {
            const domain = await domainsApi.detail(scope.clientId, id, signal)
            assertDomainScope(scope, signal)
            return { kind: 'domain', domain }
          } catch (error) {
            assertDomainScope(scope, signal)
            if ((error as ApiError).status !== 404) throw error
            // The ordinary job can disappear before cleanup. A 404 never means
            // released. Count the second HTTP GET against the same hard budget.
            if (!additionalRequest()) throw new DOMException('Status budget exhausted', 'AbortError')
          }
        }
        const release = await domainsApi.releaseStatus(scope.clientId, id, signal)
        assertDomainScope(scope, signal)
        return { kind: 'release', release }
      },
      cache: value => {
        if (!domainScopeCurrent(scope)) return
        if (value.kind === 'release') {
          client.setQueryData(domainKeys.receipt(scope, id), value.release)
          // Remove normal list/detail snapshots once release has been accepted.
          client.removeQueries({ queryKey: [...domainKeys.scope(scope), 'list'] })
        }
        client.setQueryData(domainKeys.lookup(scope, id), value)
      },
      denied: () => {
        if (!domainScopeCurrent(scope)) return
        void clearPrivateClientScope(client, scope.clientId)
        blockDomainAuthority(scope)
      },
      clear: () => {
        client.removeQueries({ queryKey: domainKeys.lookup(scope, id) })
        client.removeQueries({ queryKey: domainKeys.receipt(scope, id) })
      },
    }) }
    registry.set(key, value)
  }
  return value
}
export function useDomainTracker(scope: DomainScope, id: string) {
  const client = useQueryClient()
  const owned = useMemo(() => entry(client, scope, id), [client, scope.actorId, scope.clientId, scope.generation, id])
  const tracker = owned.tracker
  const state = useSyncExternalStore(tracker.subscribe, tracker.snapshot)
  const [now, setNow] = useState(performance.now())
  useEffect(() => {
    owned.owners++
    if (owned.teardown !== null) clearTimeout(owned.teardown)
    owned.teardown = null
    if (document.visibilityState !== 'hidden') tracker.start()
    const visibility = () => {
      if (document.visibilityState === 'hidden') tracker.pause()
      else tracker.start()
      setNow(performance.now())
    }
    document.addEventListener('visibilitychange', visibility)
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setNow(performance.now()) }, 250)
    return () => {
      document.removeEventListener('visibilitychange', visibility); clearInterval(timer)
      owned.owners--
      if (owned.owners === 0) owned.teardown = setTimeout(() => {
        tracker.pause(true)
        registries.get(client)?.delete(JSON.stringify(domainKeys.lookup(scope, id)))
      }, 0)
    }
  }, [owned, tracker, client, scope.actorId, scope.clientId, scope.generation, id])
  return { tracker, state, now }
}
