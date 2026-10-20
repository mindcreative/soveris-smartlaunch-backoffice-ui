import { clientFixturePermissions } from '../test/authorityFixtures'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useDomainTracker } from './useDomainTracker'
import { domainClientPrefix } from './billingQueries'
import { captureDomainScope } from './domainScope'
import { useAuthStore } from '../stores/authStore'
import { domainsApi } from '../api/domainsApi'
import { parseDomain, parseDomainRelease } from '../api/domainContracts'
import fixture from '../api/__fixtures__/domains-http.json'
vi.mock('../api/domainsApi', () => ({ domainsApi: { detail: vi.fn(), releaseStatus: vi.fn() } }))
const wire = fixture.cases.find(c => c.name === 'detail')!.responseBody
const domain = parseDomain(wire, JSON.parse(wire).clientId)
beforeEach(() => {
  window.dispatchEvent(new Event('auth:refreshed'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  useAuthStore.setState({ isAuthenticated: true, accessToken: 'a', user: { id: '01990000-0000-7000-8000-000000000001', clientId: domain.clientId, role: 'ClientAdmin', permissions: clientFixturePermissions, email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } })
})
it('deduplicates two consumers and StrictMode under one scoped polling owner', async () => {
  vi.mocked(domainsApi.detail).mockResolvedValue(domain)
  const client = new QueryClient(), scope = captureDomainScope()
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>
  const result = renderHook(() => [useDomainTracker(scope, domain.id), useDomainTracker(scope, domain.id)], { wrapper })
  await waitFor(() => expect(result.result.current[0]!.state.value).not.toBeNull())
  expect(domainsApi.detail).toHaveBeenCalledTimes(1)
  expect(result.result.current[0]!.tracker).toBe(result.result.current[1]!.tracker)
  result.unmount()
})
it('aborts on hidden document and resumes with a fresh GET without commands', async () => {
  let resolve!: (value: typeof domain) => void
  vi.mocked(domainsApi.detail).mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue(domain)
  const client = new QueryClient(), scope = captureDomainScope()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const result = renderHook(() => useDomainTracker(scope, domain.id), { wrapper })
  await waitFor(() => expect(domainsApi.detail).toHaveBeenCalledTimes(1))
  act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  expect(vi.mocked(domainsApi.detail).mock.calls[0]![2]!.aborted).toBe(true)
  await act(async () => resolve(domain))
  expect(result.result.current.state.value).toBeNull()
  act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await waitFor(() => expect(result.result.current.state.value).not.toBeNull())
  expect(domainsApi.detail).toHaveBeenCalledTimes(2)
  result.unmount()
})

it('recovers a cold retained release after ordinary detail 404 using the active Client', async () => {
  const receiptWire = fixture.cases.find(c => c.name === 'release-status')!.responseBody
  const receipt = parseDomainRelease(receiptWire, domain.id)
  vi.mocked(domainsApi.detail).mockRejectedValue({ status: 404, code: 'domain_not_found' })
  vi.mocked(domainsApi.releaseStatus).mockResolvedValue(receipt)
  const client = new QueryClient(), scope = captureDomainScope()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const result = renderHook(() => useDomainTracker(scope, domain.id), { wrapper })
  await waitFor(() => expect(result.result.current.state.value?.kind).toBe('release'))
  expect(domainsApi.releaseStatus).toHaveBeenCalledWith(scope.clientId, domain.id, expect.any(AbortSignal))
  result.unmount()
})

it('keeps a read-only domain404 scoped without requesting a privileged release receipt', async () => {
  useAuthStore.setState(state => ({ user: { ...state.user!, role: 'Editor', permissions: ['domains:view'] } }))
  vi.mocked(domainsApi.detail).mockRejectedValue({ status: 404, code: 'domain_not_found' })
  const client = new QueryClient(), scope = captureDomainScope()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const result = renderHook(() => useDomainTracker(scope, domain.id), { wrapper })
  await waitFor(() => expect(result.result.current.state.phase).toBe('not_found'))
  expect(domainsApi.releaseStatus).not.toHaveBeenCalled()
  expect(useAuthStore.getState().isAuthenticated).toBe(true)
  result.unmount()
})

it('purges Client-private state and blocks history re-entry after current read permission loss', async () => {
  const client = new QueryClient(), scope = captureDomainScope()
  client.setQueryData([...domainClientPrefix(scope.clientId), 'other-private-frame'], { host: domain.host })
  vi.mocked(domainsApi.detail).mockRejectedValue({ status: 403, code: 'insufficient_permissions' })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const result = renderHook(() => useDomainTracker(scope, domain.id), { wrapper })
  await waitFor(() => expect(result.result.current.state.phase).toBe('denied'))
  expect(captureDomainScope().blocked).toBe(true)
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(captureDomainScope().blocked).toBe(true)
  expect(client.getQueryData([...domainClientPrefix(scope.clientId), 'other-private-frame'])).toBeUndefined()
  result.unmount()
})
