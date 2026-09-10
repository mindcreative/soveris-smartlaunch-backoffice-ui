import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { billingApi } from '../api/billingApi'
import { billingSubscriptionKeys } from '../queries/billingQueries'
import type {
  BillingSubscriptionItem,
  BillingSubscriptionLifecycleReceipt,
  BillingSubscriptionState,
} from '../types/billing'
import {
  availableSubscriptionLifecycleActions,
  useSubscriptionLifecycle,
} from './useSubscriptionLifecycle'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-8333-444444444444'
const SUBSCRIPTION_ID = '22222222-2222-3333-8444-555555555555'
const OPERATION_ID = '01991f20-5678-7abc-8abc-1234567890ab'

function current(status: 'active' | 'paused' = 'active'): BillingSubscriptionItem {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    creationOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
    clientId: CLIENT_A,
    planName: 'Pro', cycleCreditAmount: '99999999999999.9999',
    entitlements: {
      schemaVersion: 1,
      rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
      featureFlags: { contentGeneration: true, imageGeneration: true },
    },
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    billingCycleAnchor: '2026-09-01T00:00:00Z', status,
    validFrom: '2026-09-01T00:00:00Z', validTo: null,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  }
}

function state(item: BillingSubscriptionItem | null = current()): BillingSubscriptionState {
  return {
    clientId: CLIENT_A, stateAsOf: '2026-09-07T09:00:00Z', current: item,
    pendingChange: null, subscriptionHistory: [],
    grantHistory: { items: [], historyAsOf: '2026-09-07T09:00:00Z', nextCursor: null },
  }
}

const RECEIPT: BillingSubscriptionLifecycleReceipt = {
  lifecycleOperationId: OPERATION_ID,
  clientId: CLIENT_A,
  subscriptionId: SUBSCRIPTION_ID,
  action: 'pause', previousStatus: 'active', status: 'paused',
  reason: 'Temporary administrative hold',
  effectiveAt: '2026-09-07T09:00:01Z', operationAsOf: '2026-09-07T09:00:01Z',
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useSubscriptionLifecycle', () => {
  it('derives active, paused, and exact microsecond due action matrices from stateAsOf', () => {
    expect(availableSubscriptionLifecycleActions(state())).toEqual(['pause', 'cancel'])
    expect(availableSubscriptionLifecycleActions(state(current('paused')))).toEqual(['reactivate', 'cancel'])
    expect(availableSubscriptionLifecycleActions({
      ...state(),
      current: { ...current(), validTo: '2026-09-07T09:00:00.000001Z' },
      stateAsOf: '2026-09-07T09:00:00.000000Z',
    })).toEqual(['pause', 'cancel'])
    expect(availableSubscriptionLifecycleActions({
      ...state(current('paused')),
      current: { ...current('paused'), validTo: '2026-09-07T09:00:00.000001Z' },
      stateAsOf: '2026-09-07T09:00:00.000001Z',
    })).toEqual(['expire', 'cancel'])
    expect(availableSubscriptionLifecycleActions({
      ...state(),
      stateAsOf: '2026-09-07T09:00:00.000002Z',
      current: { ...current(), validTo: '2026-09-07T09:00:00.000001Z' },
    })).toEqual(['expire', 'cancel'])
    expect(availableSubscriptionLifecycleActions(state(null))).toEqual([])
    expect(availableSubscriptionLifecycleActions(state({
      ...current(), status: 'cancelled',
    }))).toEqual([])
    expect(availableSubscriptionLifecycleActions(state({
      ...current(), status: 'expired', validTo: '2026-09-01T00:00:00Z',
    }))).toEqual([])
  })

  it('preflights and coalesces duplicate confirmation into one immutable attempt', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    let resolve: ((value: BillingSubscriptionLifecycleReceipt) => void) | undefined
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockImplementation(
      () => new Promise((next) => { resolve = next })
    )
    const preflight = vi.fn().mockResolvedValue(state())
    const uuidFactory = vi.fn(() => OPERATION_ID)
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory }),
      { wrapper: wrapper(queryClient) }
    )

    act(() => {
      void result.current.confirm('pause', RECEIPT.reason, current(), preflight)
      void result.current.confirm('cancel', 'Changed', current(), preflight)
    })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(uuidFactory).toHaveBeenCalledTimes(1)
    expect(result.current.attempt?.request).toEqual({
      lifecycleOperationId: OPERATION_ID,
      action: 'pause', expectedStatus: 'active', reason: RECEIPT.reason,
    })
    resolve?.(RECEIPT)
    await waitFor(() => expect(result.current.outcome).toBe('completed'))
  })

  it('sends nothing when fresh state differs from the confirmation snapshot', async () => {
    const queryClient = new QueryClient()
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    const changed = state(current('paused'))
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => changed)
    })
    expect(post).not.toHaveBeenCalled()
    expect(result.current.outcome).toBe('preflight-rejected')
    expect(result.current.attempt).toBeNull()
  })

  it('retains exact material after ambiguity and explicitly replays only after GET reconciliation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'disconnected' })
      .mockResolvedValueOnce(RECEIPT)
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(state(current('paused')))
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )

    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    await waitFor(() => expect(result.current.recovery).toBe('ready'))
    expect(result.current.outcome).toBe('unknown')
    const retained = result.current.attempt
    await act(async () => { await result.current.retryExact() })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[2]).toEqual(post.mock.calls[0]?.[2])
    expect(post.mock.calls[1]?.[4]).toBe(post.mock.calls[0]?.[4])
    expect(result.current.attempt).toBe(retained)
    expect(result.current.outcome).toBe('completed')
  })

  it('tears down and aborts private lifecycle state when Client changes', async () => {
    const queryClient = new QueryClient()
    let signal: AbortSignal | undefined
    let resolve: ((value: BillingSubscriptionLifecycleReceipt) => void) | undefined
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockImplementation(
      (_client, _subscription, _request, requestSignal) => {
        signal = requestSignal
        return new Promise((next) => { resolve = next })
      }
    )
    const { result, rerender } = renderHook(
      ({ clientId }) => useSubscriptionLifecycle(clientId, { uuidFactory: () => OPERATION_ID }),
      { initialProps: { clientId: CLIENT_A }, wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm('pause', RECEIPT.reason, current(), async () => state()) })
    await waitFor(() => expect(result.current.outcome).toBe('submitting'))
    rerender({ clientId: CLIENT_B })
    await waitFor(() => expect(result.current.outcome).toBe('idle'))
    expect(result.current.attempt).toBeNull()
    expect(signal?.aborted).toBe(true)
    await act(async () => { resolve?.(RECEIPT); await Promise.resolve() })
    expect(result.current.outcome).toBe('idle')
    expect(result.current.receipt).toBeNull()
  })

  it('discards an in-flight attempt and late response when authentication is cleared', async () => {
    const queryClient = new QueryClient()
    let resolve: ((value: BillingSubscriptionLifecycleReceipt) => void) | undefined
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockImplementation(
      (_client, _subscription, _request, requestSignal) => {
        signal = requestSignal
        return new Promise((next) => { resolve = next })
      }
    )
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm('pause', RECEIPT.reason, current(), async () => state()) })
    await waitFor(() => expect(result.current.outcome).toBe('submitting'))
    act(() => { window.dispatchEvent(new CustomEvent('auth:cleared')) })
    expect(signal?.aborted).toBe(true)
    expect(result.current.attempt).toBeNull()
    await act(async () => { resolve?.(RECEIPT); await Promise.resolve() })
    expect(result.current.receipt).toBeNull()
    expect(result.current.outcome).toBe('idle')
  })

  it('retains an in-flight command across the one permitted authentication refresh', async () => {
    const queryClient = new QueryClient()
    let resolve: ((value: BillingSubscriptionLifecycleReceipt) => void) | undefined
    let signal: AbortSignal | undefined
    let markOwnReplay: (() => void) | undefined
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockImplementation(
      (_client, _subscription, _request, requestSignal, _body, _validTo, onAuthReplay) => {
        signal = requestSignal
        markOwnReplay = onAuthReplay
        return new Promise((next) => { resolve = next })
      }
    )
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm('pause', RECEIPT.reason, current(), async () => state()) })
    await waitFor(() => expect(result.current.outcome).toBe('submitting'))
    act(() => {
      markOwnReplay?.()
      window.dispatchEvent(new CustomEvent('auth:refreshed'))
    })
    expect(signal?.aborted).toBe(false)
    expect(result.current.attempt?.request.lifecycleOperationId).toBe(OPERATION_ID)
    resolve?.(RECEIPT)
    await waitFor(() => expect(result.current.outcome).toBe('completed'))
  })

  it('tears down an in-flight command for an unrelated authentication refresh', async () => {
    const queryClient = new QueryClient()
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockImplementation(
      (_client, _subscription, _request, requestSignal) => {
        signal = requestSignal
        return new Promise(() => undefined)
      }
    )
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm('pause', RECEIPT.reason, current(), async () => state()) })
    await waitFor(() => expect(result.current.outcome).toBe('submitting'))
    act(() => { window.dispatchEvent(new CustomEvent('auth:refreshed')) })
    expect(signal?.aborted).toBe(true)
    expect(result.current.attempt).toBeNull()
    expect(result.current.outcome).toBe('idle')
  })

  it('does not dispatch when auth teardown occurs during a pending preflight', async () => {
    const queryClient = new QueryClient()
    let resolvePreflight: ((value: BillingSubscriptionState) => void) | undefined
    const preflight = () => new Promise<BillingSubscriptionState>((resolve) => {
      resolvePreflight = resolve
    })
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm('pause', RECEIPT.reason, current(), preflight) })
    await waitFor(() => expect(result.current.outcome).toBe('preflighting'))
    act(() => { window.dispatchEvent(new CustomEvent('auth:cleared')) })
    await act(async () => { resolvePreflight?.(state()); await Promise.resolve() })
    expect(post).not.toHaveBeenCalled()
    expect(result.current.attempt).toBeNull()
  })

  it('does not dispatch when Client changes during a pending preflight', async () => {
    const queryClient = new QueryClient()
    let resolvePreflight: ((value: BillingSubscriptionState) => void) | undefined
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
    const { result, rerender } = renderHook(
      ({ clientId }) => useSubscriptionLifecycle(clientId, { uuidFactory: () => OPERATION_ID }),
      { initialProps: { clientId: CLIENT_A }, wrapper: wrapper(queryClient) }
    )
    act(() => {
      void result.current.confirm('pause', RECEIPT.reason, current(), () =>
        new Promise((resolve) => { resolvePreflight = resolve }))
    })
    await waitFor(() => expect(result.current.outcome).toBe('preflighting'))
    rerender({ clientId: CLIENT_B })
    await act(async () => { resolvePreflight?.(state()); await Promise.resolve() })
    expect(post).not.toHaveBeenCalled()
    expect(result.current.attempt).toBeNull()
    expect(result.current.outcome).toBe('idle')
  })

  it('does not dispatch after unmount during a pending preflight', async () => {
    const queryClient = new QueryClient()
    let resolvePreflight: ((value: BillingSubscriptionState) => void) | undefined
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
    const { result, unmount } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => {
      void result.current.confirm('pause', RECEIPT.reason, current(), () =>
        new Promise((resolve) => { resolvePreflight = resolve }))
    })
    await waitFor(() => expect(result.current.outcome).toBe('preflighting'))
    unmount()
    await act(async () => { resolvePreflight?.(state()); await Promise.resolve() })
    expect(post).not.toHaveBeenCalled()
  })

  it('blocks exact replay when the retained subscription is absent from reconciled scope', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'disconnected' })
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(state(null))
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.recovery).toBe('mismatch')
    await act(async () => { await result.current.retryExact() })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('keeps new commands blocked until abandon completes a fresh authoritative GET', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let getCount = 0
    let resolveAbandon: ((value: BillingSubscriptionState) => void) | undefined
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      code: 'NETWORK_ERROR', message: 'disconnected',
    })
    vi.spyOn(billingApi, 'getSubscriptionState').mockImplementation(() => {
      getCount += 1
      if (getCount === 1) return Promise.resolve(state())
      return new Promise((resolve) => { resolveAbandon = resolve })
    })
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('unknown')
    act(() => { void result.current.abandon() })
    await waitFor(() => expect(result.current.outcome).toBe('preflighting'))
    expect(result.current.attempt).toBeNull()
    resolveAbandon?.(state())
    await waitFor(() => expect(result.current.outcome).toBe('idle'))
  })

  it('clears immediately when ambiguity reconciliation returns fresh permission denial', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const denied = vi.fn()
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      code: 'NETWORK_ERROR', message: 'disconnected',
    })
    vi.spyOn(billingApi, 'getSubscriptionState').mockRejectedValue({
      status: 403, code: 'HTTP_403', message: 'private denial',
    })
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, {
        uuidFactory: () => OPERATION_ID, onPermissionDenied: denied,
      }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('idle')
    expect(result.current.attempt).toBeNull()
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }))
  })

  it('clears every private Billing cache and local operation on fresh permission denial', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['backoffice', 'private', 'billing', 'account', CLIENT_A], { private: true })
    const denied = vi.fn()
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      status: 403, code: 'HTTP_403', message: 'raw private message',
    })
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, {
        uuidFactory: () => OPERATION_ID, onPermissionDenied: denied,
      }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('idle')
    expect(result.current.attempt).toBeNull()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
    expect(denied).toHaveBeenCalledTimes(1)
  })

  it('clears private state and announces session end on a fresh 401 result', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(billingSubscriptionKeys.state(CLIENT_A), state())
    const denied = vi.fn()
    const cleared = vi.fn()
    window.addEventListener('auth:cleared', cleared, { once: true })
    vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      status: 401, code: 'HTTP_401', message: 'raw token detail',
    })
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, {
        uuidFactory: () => OPERATION_ID, onPermissionDenied: denied,
      }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('idle')
    expect(result.current.attempt).toBeNull()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
    expect(denied).toHaveBeenCalledTimes(1)
    expect(cleared).toHaveBeenCalledTimes(1)
  })

  it('keeps exact retry disabled when authoritative reconciliation fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'disconnected' })
    vi.spyOn(billingApi, 'getSubscriptionState').mockRejectedValue(new Error('still offline'))
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.recovery).toBe('unavailable')
    await act(async () => { await result.current.retryExact() })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('classifies a dispatched timeout as unknown and never retries automatically', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded',
    })
    vi.spyOn(billingApi, 'getSubscriptionState').mockResolvedValue(state())
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('unknown')
    expect(result.current.recovery).toBe('ready')
    expect(post).toHaveBeenCalledTimes(1)
    await act(async () => { await Promise.resolve() })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('requires determinate review before creating a fresh operation identity', async () => {
    const queryClient = new QueryClient()
    const secondOperationId = '01991f20-5678-7abc-8abc-1234567890ac'
    const uuidFactory = vi.fn()
      .mockReturnValueOnce(OPERATION_ID)
      .mockReturnValueOnce(secondOperationId)
    const post = vi.spyOn(billingApi, 'postSubscriptionLifecycle').mockRejectedValue({
      status: 409, code: 'subscription_lifecycle_state_conflict', message: 'stale',
    })
    const { result } = renderHook(
      () => useSubscriptionLifecycle(CLIENT_A, { uuidFactory }),
      { wrapper: wrapper(queryClient) }
    )
    await act(async () => {
      await result.current.confirm('pause', RECEIPT.reason, current(), async () => state())
    })
    expect(result.current.outcome).toBe('rejected')
    await act(async () => { await result.current.abandon() })
    await act(async () => {
      await result.current.confirm('cancel', 'Terminal operator decision', current(), async () => state())
    })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]?.[2].lifecycleOperationId).toBe(OPERATION_ID)
    expect(post.mock.calls[1]?.[2].lifecycleOperationId).toBe(secondOperationId)
    expect(post.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      action: 'cancel', expectedStatus: 'active', reason: 'Terminal operator decision',
    }))
  })
})
