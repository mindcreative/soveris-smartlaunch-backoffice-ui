import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { domainsApi } from '../api/domainsApi'
import { useAuthStore } from '../stores/authStore'
import { captureDomainScope } from './domainScope'
import { useDomainActions } from './useDomainActions'
import type { DomainTracker } from './domainTracker'
vi.mock('../api/domainsApi', () => ({ domainsApi: { retry: vi.fn(), verify: vi.fn(), primary: vi.fn(), release: vi.fn() } }))
const clientId = '0149620b-af5c-47c9-8290-95edde45ef8f', id = '01990000-0000-7000-8000-000000000001'
const tracker = { pause: vi.fn(), start: vi.fn(), deny: vi.fn(), acceptRelease: vi.fn() } as unknown as DomainTracker
beforeEach(() => { window.dispatchEvent(new Event('auth:refreshed')); useAuthStore.setState({ isAuthenticated: true, accessToken: 'current', user: { id, clientId, role: 'Admin', email: '', displayName: '', accessToken: '', refreshToken: '', expiresIn: 0 } }); })
function hook() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useDomainActions(captureDomainScope(), id, tracker, true), { wrapper })
}
it('retains Retry operation through ambiguity and allocates a fresh identity only after confirmed receipt', async () => {
  vi.mocked(domainsApi.retry).mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'lost reply' }).mockResolvedValue({} as never)
  const { result } = hook()
  await act(async () => { await result.current.retry() })
  expect(result.current.unresolvedRetry).toBe(true)
  await act(async () => { await result.current.retry() })
  expect(vi.mocked(domainsApi.retry).mock.calls[1]![1]).toBe(vi.mocked(domainsApi.retry).mock.calls[0]![1])
  expect(result.current.unresolvedRetry).toBe(false)
  await act(async () => { await result.current.retry() })
  expect(vi.mocked(domainsApi.retry).mock.calls[2]![1]).not.toBe(vi.mocked(domainsApi.retry).mock.calls[0]![1])
})
it('never blindly bumps primary revision after conflict', async () => {
  vi.mocked(domainsApi.primary).mockRejectedValue({ status: 409, code: 'stale_revision', message: 'stale' })
  const { result } = hook()
  await act(async () => { await result.current.primary('9223372036854775807') })
  expect(domainsApi.primary).toHaveBeenCalledTimes(1)
  expect(vi.mocked(domainsApi.primary).mock.calls[0]![2]).toBe('9223372036854775807')
  expect(tracker.start).toHaveBeenCalledTimes(1)
  expect(result.current.message).toContain('review it')
})
it('fences a late mutation callback after changed session authority and prevents duplicate clicks', async () => {
  let resolve!: (value: never) => void
  vi.mocked(domainsApi.verify).mockReturnValue(new Promise(r => { resolve = r }))
  const { result } = hook()
  let first!: Promise<boolean>
  act(() => { first = result.current.verify(); void result.current.verify() })
  await waitFor(() => expect(domainsApi.verify).toHaveBeenCalledTimes(1))
  act(() => useAuthStore.setState({ accessToken: 'changed' }))
  await act(async () => { resolve({} as never); await first })
  expect(tracker.start).not.toHaveBeenCalled()
  expect(result.current.message).not.toContain('Action accepted')
})
it('clears protected tracking when current action permission is revoked', async () => {
  vi.mocked(domainsApi.verify).mockRejectedValue({ status: 403, code: 'insufficient_permissions', message: 'Denied' })
  const { result } = hook()
  await act(async () => { await result.current.verify() })
  expect(tracker.deny).toHaveBeenCalledTimes(1)
})

it('reconciles a lost DELETE reply by status and never automatically repeats DELETE', async () => {
  vi.mocked(domainsApi.release).mockRejectedValue({ code: 'NETWORK_ERROR', message: 'lost reply' })
  const { result } = hook()
  await act(async () => { await result.current.release() })
  expect(domainsApi.release).toHaveBeenCalledTimes(1)
  expect(tracker.start).toHaveBeenCalledTimes(1)
  expect(result.current.message).toContain('Outcome unconfirmed')
})
