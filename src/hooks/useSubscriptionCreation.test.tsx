import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { billingApi } from '../api/billingApi'
import type {
  BillingSubscriptionCreationReceipt,
  CreateBillingSubscriptionMaterial,
} from '../types/billing'
import { useSubscriptionCreation } from './useSubscriptionCreation'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'
const OPERATION_ID = '01991f20-1234-7abc-8abc-1234567890ab'

const MATERIAL: CreateBillingSubscriptionMaterial = {
  planName: 'Pro', subscriptionTier: 'brand_premium', cycleCreditAmount: '1250.0000',
  validFrom: '2026-09-01T00:00:00.000Z', validTo: null,
  changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
  entitlements: {
    schemaVersion: 1,
    rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
    featureFlags: { contentGeneration: true, imageGeneration: true },
  },
}

const RECEIPT = { created: true } as BillingSubscriptionCreationReceipt

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useSubscriptionCreation', () => {
  it('coalesces synchronous duplicate confirmation into one immutable UUIDv7 attempt', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    let resolve: ((receipt: BillingSubscriptionCreationReceipt) => void) | undefined
    const create = vi.spyOn(billingApi, 'createSubscription').mockImplementation(
      () => new Promise((next) => { resolve = next })
    )
    const uuidFactory = vi.fn(() => OPERATION_ID)
    const { result } = renderHook(
      () => useSubscriptionCreation(CLIENT_A, { uuidFactory }),
      { wrapper: wrapper(queryClient) }
    )

    act(() => {
      void result.current.confirm(MATERIAL)
      void result.current.confirm({ ...MATERIAL, planName: 'Changed' })
    })

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(uuidFactory).toHaveBeenCalledTimes(1)
    expect(result.current.attempt?.request.planName).toBe('Pro')
    expect(result.current.attempt?.request.subscriptionTier).toBe('brand_premium')
    expect(result.current.attempt?.request.creationOperationId).toBe(OPERATION_ID)
    resolve?.(RECEIPT)
    await waitFor(() => expect(result.current.outcome).toBe('created'))
  })

  it('retains exact identity and serialized body after ambiguity and explicit retry', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const create = vi.spyOn(billingApi, 'createSubscription')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'disconnected' })
      .mockResolvedValueOnce({ ...RECEIPT, created: false })
    const { result } = renderHook(
      () => useSubscriptionCreation(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )

    await act(async () => { await result.current.confirm(MATERIAL) })
    expect(result.current.outcome).toBe('unknown')
    const retained = result.current.attempt
    expect(retained?.serializedBody).toContain(OPERATION_ID)
    expect(retained?.serializedBody).toContain('"subscriptionTier":"brand_premium"')

    await act(async () => { await result.current.retry() })
    expect(result.current.outcome).toBe('replayed')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]?.[1]).toEqual(create.mock.calls[0]?.[1])
    expect(create.mock.calls[1]?.[3]).toBe(create.mock.calls[0]?.[3])
    expect(result.current.attempt).toBe(retained)
  })

  it('detaches and aborts an in-flight attempt when the route Client changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'createSubscription').mockImplementation(
      (_clientId, _request, requestSignal) => {
        signal = requestSignal
        return new Promise(() => undefined)
      }
    )
    const { result, rerender } = renderHook(
      ({ clientId }) => useSubscriptionCreation(clientId, { uuidFactory: () => OPERATION_ID }),
      { initialProps: { clientId: CLIENT_A }, wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm(MATERIAL) })
    expect(result.current.attempt?.clientId).toBe(CLIENT_A)

    rerender({ clientId: CLIENT_B })

    await waitFor(() => expect(result.current.attempt).toBeNull())
    expect(signal?.aborted).toBe(true)
    expect(result.current.outcome).toBe('idle')
  })

  it('retains an in-flight command for the permitted byte-identical auth refresh replay', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    let resolve: ((receipt: BillingSubscriptionCreationReceipt) => void) | undefined
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'createSubscription').mockImplementation((_clientId, _request, requestSignal) => {
      signal = requestSignal
      return new Promise((next) => { resolve = next })
    })
    const { result } = renderHook(
      () => useSubscriptionCreation(CLIENT_A, { uuidFactory: () => OPERATION_ID }),
      { wrapper: wrapper(queryClient) }
    )
    act(() => { void result.current.confirm(MATERIAL) })
    await waitFor(() => expect(result.current.outcome).toBe('submitting'))

    act(() => { window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { waitUntil: vi.fn() } })) })
    expect(signal?.aborted).toBe(false)
    expect(result.current.attempt?.request.creationOperationId).toBe(OPERATION_ID)
    resolve?.(RECEIPT)
    await waitFor(() => expect(result.current.outcome).toBe('created'))
  })
})
