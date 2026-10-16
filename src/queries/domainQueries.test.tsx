import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useAuthStore } from '../stores/authStore'
import { captureDomainScope, domainScopeCurrent } from './domainScope'
import { useDomains, useDomainProducts, domainKeys } from './domainQueries'
import { domainsApi } from '../api/domainsApi'
import { contentApi } from '../api/endpoints'
vi.mock('../api/domainsApi', () => ({ domainsApi: { list: vi.fn() } }))
vi.mock('../api/endpoints', () => ({ contentApi: { getProducts: vi.fn() }, authApi: {} }))
const clientId = '0149620b-af5c-47c9-8290-95edde45ef8f'
const actorId = '01990000-0000-7000-8000-000000000001'
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
beforeEach(() => { client.clear(); useAuthStore.setState({ isAuthenticated: true, accessToken: 'a', user: { id: actorId, clientId, role: 'Admin', email: '', displayName: '', accessToken: 'a', refreshToken: '', expiresIn: 1 } }) })
it('fences late GET after Client/session change before Query can cache it', async () => {
  let resolve!: (value: never) => void
  vi.mocked(domainsApi.list).mockReturnValue(new Promise(r => { resolve = r }))
  const scope = captureDomainScope()
  const result = renderHook(() => useDomains(scope, 1, true), { wrapper })
  await waitFor(() => expect(domainsApi.list).toHaveBeenCalledTimes(1))
  act(() => useAuthStore.setState({ accessToken: 'new-authority' }))
  resolve({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 } as never)
  await waitFor(() => expect(result.result.current.isError).toBe(true))
  expect(client.getQueryData(domainKeys.list(scope, 1))).toBeUndefined()
  expect(domainScopeCurrent(scope)).toBe(false)
})
it('never queries Product selection without its separate view gate', () => {
  renderHook(() => useDomainProducts(captureDomainScope(), 1, false), { wrapper })
  expect(contentApi.getProducts).not.toHaveBeenCalled()
})
it('retires in-flight intent on auth refresh and history events, even with unchanged actor/Client', () => {
  let scope = captureDomainScope()
  window.dispatchEvent(new Event('auth:refreshed')); expect(domainScopeCurrent(scope)).toBe(false)
  scope = captureDomainScope()
  window.dispatchEvent(new Event('popstate')); expect(domainScopeCurrent(scope)).toBe(false)
})

it('changes private query identity for a different authenticated Client even with the same actor and token', () => {
  const previous = captureDomainScope()
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, clientId: '01990000-0000-7000-8000-000000000004' } })
  const next = captureDomainScope()
  expect(domainScopeCurrent(previous)).toBe(false)
  expect(domainScopeCurrent(next)).toBe(true)
  expect(domainKeys.list(next, 1)).not.toEqual(domainKeys.list(previous, 1))
})
