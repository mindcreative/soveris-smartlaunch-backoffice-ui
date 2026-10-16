import { useQuery, type QueryClient } from '@tanstack/react-query'
import { domainsApi } from '../api/domainsApi'
import { DomainContractError } from '../api/domainContracts'
import { contentApi } from '../api/endpoints'
import { domainClientPrefix, clientCapabilityKeys } from './billingQueries'
import { productKeys } from './productQueries'
import { domainScopeCurrent, type DomainScope } from './domainScope'

export const domainKeys = {
  scope: (s: DomainScope) => [...domainClientPrefix(s.clientId), s.actorId, s.generation] as const,
  list: (s: DomainScope, page: number) => [...domainKeys.scope(s), 'list', page] as const,
  lookup: (s: DomainScope, id: string) => [...domainKeys.scope(s), 'lookup', id] as const,
  receipt: (s: DomainScope, id: string) => [...domainKeys.scope(s), 'release', id] as const,
  command: (s: DomainScope, id: string, action: string) => [...domainKeys.scope(s), 'command', id, action] as const,
}
export function assertDomainScope(scope: DomainScope, signal?: AbortSignal) {
  if (signal?.aborted || !domainScopeCurrent(scope)) throw new DOMException('Private domain scope changed', 'AbortError')
}
export function useDomains(scope: DomainScope, page: number, enabled: boolean) {
  return useQuery({
    queryKey: domainKeys.list(scope, page), enabled: enabled && domainScopeCurrent(scope),
    queryFn: async ({ signal }) => {
      assertDomainScope(scope, signal)
      const started = performance.now()
      const value = await domainsApi.list(scope.clientId, page, signal)
      assertDomainScope(scope, signal)
      return { value, receivedAt: performance.now(), requestElapsed: performance.now() - started }
    },
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
}
export function useDomainProducts(scope: DomainScope, page: number, enabled: boolean) {
  return useQuery({
    queryKey: [...domainKeys.scope(scope), 'products', page], enabled: enabled && domainScopeCurrent(scope),
    queryFn: async ({ signal }) => {
      assertDomainScope(scope, signal)
      const result = await contentApi.getProducts(scope.clientId, { page, pageSize: 20, status: 'active' }, signal)
      assertDomainScope(scope, signal)
      if (result.items.some(p => p.clientId.toLowerCase() !== scope.clientId || p.status !== 'active')) throw new DomainContractError()
      return result
    }, retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
  })
}
export async function invalidateDomainConsequences(client: QueryClient, scope: DomainScope, productsAllowed: boolean) {
  if (!domainScopeCurrent(scope)) return
  await Promise.all([
    client.invalidateQueries({ queryKey: [...domainKeys.scope(scope), 'list'] }),
    client.invalidateQueries({ queryKey: clientCapabilityKeys.client(scope.clientId) }),
    ...(productsAllowed ? [client.invalidateQueries({ queryKey: productKeys.client(scope.clientId) })] : []),
  ])
}
