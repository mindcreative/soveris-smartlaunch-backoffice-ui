import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSupportMetadata } from './useSupportMetadata'
import { remainingSupportSeconds } from './SupportTime'
import { supportApi } from './client'
import { SupportAccessError } from './errors'
import { supportAuthority } from './authority'
import { useAuthStore } from '../stores/authStore'
import { currentAuthorityFixture } from '../test/authorityFixtures'
import type { SupportMetadata } from './models'

vi.mock('./client', () => ({ supportApi: { list: vi.fn(), detail: vi.fn(), approve: vi.fn(), activate: vi.fn(), draft: vi.fn(), identity: vi.fn() } }))
const grant = '019d0e15-c3f0-7a55-8bc2-9cf0a1b2c3d4'
let metadata: SupportMetadata
beforeEach(() => {
  vi.useFakeTimers()
  supportAuthority.retire()
  useAuthStore.setState({ user: currentAuthorityFixture(), isAuthenticated: true, isInitialized: true, isLoading: false })
  metadata = { id: grant, operatorId: grant, operatorName: 'Operator', targetClientId: grant, targetClientName: 'Customer',
    products: [{ id: grant, name: 'Product', slug: 'product' }], originalWorkspaceName: null, productIds: [grant], operations: ['product.identity.read'],
    scopeVersion: 'support-read-v1', scopeHash: 'a'.repeat(64), labelReviewHash: 'b'.repeat(64), labelsChanged: false, requestLabels: null, currentLabels: null,
    createdAt: new Date().toISOString(), supportCaseReference: 'clock:case', state: 'approved', revision: '2', durationMinutes: 1, reason: 'Support case',
    requestExpiresAt: new Date(Date.now() + 86400000).toISOString(), approvedAt: new Date().toISOString(), activationDeadline: new Date(Date.now() + 86400000).toISOString(),
    startsAt: null, expiresAt: null, endedAt: null, terminalReason: null, clock: { serverMilliseconds: Date.now(), monotonicMilliseconds: performance.now() } }
  vi.mocked(supportApi.list).mockImplementation(async () => ({ items: [metadata], nextCursor: null }))
  vi.mocked(supportApi.detail).mockImplementation(async () => metadata)
})
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); supportAuthority.retire() })

it('AV7 visible polling updates the selected owner detail every 15 seconds and pauses while hidden without private reads or mutations', async () => {
  const hook = renderHook(() => useSupportMetadata(true, true))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await hook.result.current.refresh(grant) })
  metadata = { ...metadata, state: 'active', revision: '3', startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(hook.result.current.detail?.state).toBe('active')
  const reads = vi.mocked(supportApi.list).mock.calls.length
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(supportApi.list).toHaveBeenCalledTimes(reads)
  expect(supportApi.draft).not.toHaveBeenCalled()
  expect(supportApi.identity).not.toHaveBeenCalled()
  expect(supportApi.approve).not.toHaveBeenCalled()
  expect(supportApi.activate).not.toHaveBeenCalled()
})

it('AV7 coalesces overlapping returns and refuses an older active response after terminal metadata', async () => {
  const hook = renderHook(() => useSupportMetadata(true, true))
  await act(async () => { await Promise.resolve() })
  metadata = { ...metadata, state: 'ended', revision: '4', endedAt: new Date().toISOString(), terminalReason: 'exited' }
  await act(async () => { await hook.result.current.refresh(grant) })
  let finish!: (value: SupportMetadata) => void
  vi.mocked(supportApi.detail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let first!: Promise<void>
  let second!: Promise<void>
  await act(async () => {
    first = hook.result.current.refresh()
    second = hook.result.current.refresh()
    await Promise.resolve()
  })
  expect(first).toBe(second)
  await act(async () => { finish({ ...metadata, state: 'active', revision: '3' }); await first })
  expect(hook.result.current.detail?.state).toBe('ended')
  expect(hook.result.current.stale).toBe(true)
})

it('AV7 countdown uses absolute server time and monotonic elapsed time despite browser clock changes', () => {
  const server = Date.parse('2026-11-06T12:00:00Z')
  const active = { ...metadata, state: 'active' as const, expiresAt: '2026-11-06T12:01:00Z', clock: { serverMilliseconds: server, monotonicMilliseconds: 1000 } }
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
  expect(remainingSupportSeconds(active, 1000)).toBe(60)
  expect(remainingSupportSeconds(active, 60000)).toBe(1)
  expect(remainingSupportSeconds(active, 61000)).toBe(0)
  expect(remainingSupportSeconds(active, 90000)).toBe(0)
  expect(active.expiresAt).toBe('2026-11-06T12:01:00Z')
})

it('AV7 respects a distributed retry deadline and clears the stale notice only after successful current metadata verification', async () => {
  const hook = renderHook(() => useSupportMetadata(true, true))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await hook.result.current.refresh(grant) })
  vi.mocked(supportApi.list).mockRejectedValueOnce(new SupportAccessError(429, 60))
  await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve() })
  expect(hook.result.current.stale).toBe(true)
  const calls = vi.mocked(supportApi.list).mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(45000) })
  expect(supportApi.list).toHaveBeenCalledTimes(calls)
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(supportApi.list).toHaveBeenCalledTimes(calls + 1)
  expect(hook.result.current.stale).toBe(false)
  expect(supportAuthority.snapshot().notice).toBeNull()
  expect(supportAuthority.snapshot().context).toBeNull()
})

it('AV2 AV7 old authority callbacks cannot cancel a newer metadata verification', async () => {
  const listeners = vi.spyOn(window, 'addEventListener')
  const hook = renderHook(() => useSupportMetadata(true, true))
  await act(async () => { await Promise.resolve() })
  const retiredRefresh = hook.result.current.refresh
  const retiredReconcile = hook.result.current.reconcile
  const retiredFocus = listeners.mock.calls.find(call => call[0] === 'focus')?.[1]
  expect(typeof retiredFocus).toBe('function')
  let finish!: (value: { items: SupportMetadata[]; nextCursor: null }) => void
  vi.mocked(supportApi.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => {
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, assuranceGeneration: 'new-current-assurance' } })
    await Promise.resolve()
  })
  const calls = vi.mocked(supportApi.list).mock.calls
  const signal = calls[calls.length - 1]![2]!
  const count = calls.length
  await act(async () => {
    await retiredRefresh(grant)
    await retiredReconcile({ ...metadata, state: 'ended', revision: '3' })
  })
  expect(supportApi.list).toHaveBeenCalledTimes(count)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  act(() => { (retiredFocus as EventListener).call(window, new Event('focus')) })
  expect(signal.aborted).toBe(false)
  visibility.mockRestore()
  await act(async () => { finish({ items: [metadata], nextCursor: null }); await Promise.resolve() })
  expect(hook.result.current.visible?.page.items[0]?.state).toBe('approved')
  expect(hook.result.current.stale).toBe(false)
})
