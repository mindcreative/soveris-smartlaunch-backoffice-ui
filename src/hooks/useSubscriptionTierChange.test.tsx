import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { billingApi } from '../api/billingApi'
import type {
  BillingSubscriptionState,
  BillingSubscriptionTierChangeResponse,
  ResourceAccessPreview,
} from '../types/billing'
import { useSubscriptionTierChange } from './useSubscriptionTierChange'
import { billingSubscriptionKeys, clientCapabilityKeys } from '../queries/billingQueries'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const OPERATION = '01991f20-1234-7abc-8abc-1234567890ab'
const AT = '2026-09-20T12:00:00.000000Z'

const STATE = {
  clientId: CLIENT, stateAsOf: AT,
  current: {
    subscriptionId: SUBSCRIPTION, creationOperationId: OPERATION,
    planTermsOperationId: OPERATION, clientId: CLIENT, planName: 'Pro',
    subscriptionTier: 'brand', tierRevision: '7', cycleCreditAmount: '100',
    entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 }, featureFlags: { contentGeneration: true, imageGeneration: true } },
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    billingCycleAnchor: AT, status: 'active', validFrom: AT, validTo: null,
    createdAt: AT, updatedAt: AT,
  }, pendingChange: null, subscriptionHistory: [],
  grantHistory: { items: [], historyAsOf: AT, nextCursor: null },
} satisfies BillingSubscriptionState

const PREVIEW = {
  clientId: CLIENT, subscriptionId: SUBSCRIPTION, action: 'schedule',
  currentSubscriptionTier: 'brand', targetSubscriptionTier: 'basic',
  effectivePolicy: 'next_billing_cycle', statusRevision: '4', classificationRevision: '5',
  tierRevision: '7', pendingTierChangeOperationId: null,
  policyPublicationId: '22222222-2222-3333-8444-555555555555',
  policyActivationRevision: '9', policyVersion: 'input-04-v1', policyHash: 'abc', commandEffectiveAt: '2026-09-30T08:30:00.000000Z', commandAuthorityHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  evaluatedAt: AT, lossAt: '2026-09-30T08:30:00.000000Z',
  accessUntil: '2026-10-07T08:30:00.000000Z', earliestProofExpiry: null, retainedCount: 1,
  totalCount: 3, graceCount: 2, suspendedCount: 0,
  deadlineGroups: [{ lossAt: '2026-09-30T08:30:00.000000Z', accessUntil: '2026-10-07T08:30:00.000000Z', graceCount: 2, newlyAffectedCount: 2 }],
  deadlineGroupsTruncated: false, unlistedGraceCount: 0, unlistedNewlyAffectedCount: 0,
  affectedResourcesTruncated: false,
  preservationFacts: { contentPreserved: true, assetsPreserved: true, creditsUnchanged: true, acceptedAiWorkUnchanged: true },
  affectedResources: [],
} satisfies ResourceAccessPreview

const RESPONSE = {
  schemaVersion: 1,
  receipt: {
    schemaVersion: 1, operationId: OPERATION, clientId: CLIENT, subscriptionId: SUBSCRIPTION,
    outcome: 'scheduled', effectivePolicy: 'next_billing_cycle', requestedSubscriptionTier: 'basic',
    previousSubscriptionTier: 'brand', resultingSubscriptionTier: 'brand', expectedTierRevision: '7',
    previousTierRevision: '7', resultingTierRevision: '7', reason: 'Approved downgrade',
    operationAsOf: AT, effectiveAt: '2026-09-30T08:30:00.000000Z',
  },
  tierState: {
    subscriptionTier: 'brand', tierRevision: '7', status: 'active', validFrom: AT,
    validTo: null, pendingTierChange: null, observedAt: AT,
  },
} satisfies BillingSubscriptionTierChangeResponse

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useSubscriptionTierChange', () => {
  it('allows immediate grace clocks to advance while stable authority stays equal', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    const first = { ...PREVIEW, action: 'apply_immediate' as const,
      effectivePolicy: 'immediate' as const, commandEffectiveAt: null }
    const second = { ...first,
      evaluatedAt: '2026-09-20T12:00:01.000000Z',
      lossAt: '2026-09-20T12:00:01.000000Z',
      accessUntil: '2026-09-27T12:00:01.000000Z',
      deadlineGroups: [{ lossAt: '2026-09-20T12:00:01.000000Z',
        accessUntil: '2026-09-27T12:00:01.000000Z', graceCount: 2,
        newlyAffectedCount: 2 }],
    }
    vi.spyOn(billingApi, 'getResourceAccessPreview')
      .mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const post = vi.spyOn(billingApi, 'postSubscriptionTierChange')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'disconnected' })
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory: () => OPERATION }),
      { wrapper: wrapper(client) }
    )
    await act(async () => { await result.current.prepare({
      action: 'apply_immediate', subscriptionTier: 'basic', expectedTierRevision: '7',
      effectivePolicy: 'immediate', reason: 'Approved downgrade',
    }, STATE) })
    expect(result.current.phase).toBe('confirmable')
    await act(async () => { await result.current.confirm(async () => STATE) })
    expect(post).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('unknown')
  })

  it('rejects a preview whose tier revision no longer matches fresh subscription state', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue({ ...PREVIEW, tierRevision: '8' })
    const post = vi.spyOn(billingApi, 'postSubscriptionTierChange')
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })

    expect(result.current.phase).toBe('rejected')
    expect(result.current.confirmation).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('requires a new confirmation when policy identity changes before submit', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    vi.spyOn(billingApi, 'getResourceAccessPreview')
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({ ...PREVIEW, policyVersion: 'input-04-v2' })
    const post = vi.spyOn(billingApi, 'postSubscriptionTierChange')
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    expect(result.current.phase).toBe('confirmable')
    await act(async () => { await result.current.confirm(async () => STATE) })

    expect(result.current.phase).toBe('rejected')
    expect(result.current.confirmation).toBeNull()
    expect(uuidFactory).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('creates identity only on submit and replays the byte-identical retained command after ambiguity', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryDefaults(billingSubscriptionKeys.state(CLIENT), { queryFn: async () => STATE })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(billingApi, 'postSubscriptionTierChange')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'disconnected' })
      .mockResolvedValueOnce(RESPONSE)
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    expect(result.current.phase).toBe('confirmable')
    expect(uuidFactory).not.toHaveBeenCalled()

    await act(async () => { await result.current.confirm(async () => STATE) })
    expect(result.current.phase).toBe('unknown')
    expect(uuidFactory).toHaveBeenCalledTimes(1)
    const retained = result.current.attempt
    expect(retained?.serializedBody).toContain(`"operationId":"${OPERATION}"`)

    await act(async () => { await result.current.retry() })
    await waitFor(() => expect(result.current.phase).toBe('succeeded'))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[2]).toBe(post.mock.calls[0]?.[2])
    expect(post.mock.calls[1]?.[5]).toBe(post.mock.calls[0]?.[5])
    expect(post.mock.calls[1]?.[4]).not.toBe(post.mock.calls[0]?.[4])
    expect(post.mock.calls[0]?.[4]).toBeInstanceOf(AbortSignal)
    expect(post.mock.calls[1]?.[4]).toBeInstanceOf(AbortSignal)
    expect(result.current.attempt).toBe(retained)
  })

  it('does not call stale cached state reconciled when the authoritative refresh fails', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryDefaults(billingSubscriptionKeys.state(CLIENT), {
      queryFn: async () => { throw new Error('subscription read unavailable') },
    })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockResolvedValue(RESPONSE)
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory: () => OPERATION }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })

    expect(result.current.result).toEqual(RESPONSE)
    expect(result.current.phase).toBe('reconciliation_delayed')
  })

  it('fences and purges an in-flight preview when Client scope changes', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockImplementation(
      (_clientId, _subscriptionId, _request, requestSignal) => {
        signal = requestSignal
        return new Promise(() => undefined)
      }
    )
    const { result, rerender } = renderHook(
      ({ clientId }) => useSubscriptionTierChange(clientId, SUBSCRIPTION),
      { initialProps: { clientId: CLIENT }, wrapper: wrapper(client) }
    )
    act(() => { void result.current.prepare({
      action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
      effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
    }, STATE) })
    await waitFor(() => expect(result.current.phase).toBe('previewing'))
    rerender({ clientId: 'ffffffff-1111-2222-8333-444444444444' })
    await waitFor(() => expect(result.current.phase).toBe('idle'))
    expect(signal?.aborted).toBe(true)
    expect(result.current.confirmation).toBeNull()
  })

  it('purges target-derived authority on privacy-safe not found without refetching it', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    client.setQueryData(clientCapabilityKeys.client(CLIENT), { stale: true })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockRejectedValue({
      code: 'subscription_not_found', message: 'Not found', status: 404,
    })
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory: () => OPERATION }),
      { wrapper: wrapper(client) }
    )

    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })

    await waitFor(() => expect(result.current.phase).toBe('rejected'))
    expect(result.current.attempt).toBeNull()
    expect(result.current.confirmation).toBeNull()
    expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT))).toBeUndefined()
    expect(client.getQueryData(clientCapabilityKeys.client(CLIENT))).toBeUndefined()
  })

  it('purges cached subscription evidence when the preview returns 404', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    client.setQueryData(clientCapabilityKeys.client(CLIENT), { private: true })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockRejectedValue({
      status: 404, code: 'subscription_not_found', message: 'Not found',
    })
    const { result } = renderHook(() => useSubscriptionTierChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) })
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.confirmation).toBeNull()
    expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT))).toBeUndefined()
    expect(client.getQueryData(clientCapabilityKeys.client(CLIENT))).toBeUndefined()
  })

  it('purges all private authority and invokes the permission boundary on 403', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    client.setQueryData(clientCapabilityKeys.client(CLIENT), { stale: true })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockRejectedValue({
      code: 'insufficient_permissions', message: 'private denial detail', status: 403,
    })
    const onPermissionDenied = vi.fn()
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, {
        uuidFactory: () => OPERATION, onPermissionDenied,
      }),
      { wrapper: wrapper(client) }
    )
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })

    expect(result.current.phase).toBe('idle')
    expect(result.current.attempt).toBeNull()
    expect(result.current.confirmation).toBeNull()
    expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT))).toBeUndefined()
    expect(client.getQueryData(clientCapabilityKeys.client(CLIENT))).toBeUndefined()
    expect(onPermissionDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }))
  })

  it('ends a deterministic rejection and requires a new preview and operation identity', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockRejectedValue({
      code: 'subscription_tier_change_invalid_request', message: 'Rejected', status: 400,
    })
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, { uuidFactory }),
      { wrapper: wrapper(client) }
    )
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })

    expect(result.current.phase).toBe('rejected')
    expect(result.current.attempt).toBeNull()
    expect(result.current.confirmation).toBeNull()
    expect(uuidFactory).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight command and ignores its late receipt after a Client switch', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    let resolvePost: ((value: BillingSubscriptionTierChangeResponse) => void) | undefined
    let commandSignal: AbortSignal | undefined
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockImplementation(
      (_clientId, _subscriptionId, _action, _request, signal) => {
        commandSignal = signal
        return new Promise((resolve) => { resolvePost = resolve })
      }
    )
    const { result, rerender } = renderHook(
      ({ clientId }) => useSubscriptionTierChange(clientId, SUBSCRIPTION, {
        uuidFactory: () => OPERATION,
      }),
      { initialProps: { clientId: CLIENT }, wrapper: wrapper(client) }
    )
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    act(() => { void result.current.confirm(async () => STATE) })
    await waitFor(() => expect(result.current.phase).toBe('submitting'))

    rerender({ clientId: 'ffffffff-1111-2222-8333-444444444444' })
    await waitFor(() => expect(result.current.phase).toBe('idle'))
    expect(commandSignal?.aborted).toBe(true)
    resolvePost?.(RESPONSE)
    await Promise.resolve()
    expect(result.current.result).toBeNull()
    expect(result.current.attempt).toBeNull()
  })

  it('discards a visible confirmation when any bound authority changes', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    const { result } = renderHook(
      () => useSubscriptionTierChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) }
    )
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })

    act(() => {
      expect(result.current.discardIfAuthorityChanged({
        ...STATE,
        current: STATE.current ? { ...STATE.current, tierRevision: '8' } : null,
      })).toBe(true)
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.confirmation).toBeNull()
  })

  it.each([
    ['preview', 403], ['preview', 401],
    ['revalidation_read', 403], ['revalidation_preview', 403],
    ['revalidation_preview', 404],
  ] as const)(
    'closes and purges private state when %s returns %s', async (stage, status) => {
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
      client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
      client.setQueryData(clientCapabilityKeys.client(CLIENT), { private: true })
      const denial = { status, code: 'insufficient_permissions', message: 'private detail' }
      vi.spyOn(billingApi, 'getResourceAccessPreview')
        .mockImplementationOnce(stage === 'preview'
          ? async () => { throw denial }
          : async () => PREVIEW)
      if (stage === 'revalidation_preview') {
        vi.mocked(billingApi.getResourceAccessPreview).mockRejectedValueOnce(denial)
      }
      const onPermissionDenied = vi.fn()
      const { result } = renderHook(() => useSubscriptionTierChange(CLIENT, SUBSCRIPTION, {
        onPermissionDenied,
      }), { wrapper: wrapper(client) })
      await act(async () => {
        await result.current.prepare({
          action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
          effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
        }, STATE)
      })
      if (stage !== 'preview') {
        await act(async () => {
          await result.current.confirm(async () => {
            if (stage === 'revalidation_read') throw denial
            return STATE
          })
        })
      }
      expect(result.current.phase).toBe('idle')
      expect(result.current.confirmation).toBeNull()
      expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT))).toBeUndefined()
      expect(client.getQueryData(clientCapabilityKeys.client(CLIENT))).toBeUndefined()
      if (status === 404) expect(onPermissionDenied).not.toHaveBeenCalled()
      else expect(onPermissionDenied).toHaveBeenCalledWith(denial)
    }
  )

  it('fences an in-flight command when subscription identity changes within the same Client', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    let resolvePost: ((value: BillingSubscriptionTierChangeResponse) => void) | undefined
    let signal: AbortSignal | undefined
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockImplementation(
      (_clientId, _subscriptionId, _action, _request, requestSignal) => {
        signal = requestSignal
        return new Promise((resolve) => { resolvePost = resolve })
      }
    )
    const { result, rerender } = renderHook(
      ({ subscriptionId }) => useSubscriptionTierChange(CLIENT, subscriptionId),
      { initialProps: { subscriptionId: SUBSCRIPTION }, wrapper: wrapper(client) }
    )
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    act(() => { void result.current.confirm(async () => STATE) })
    await waitFor(() => expect(result.current.phase).toBe('submitting'))
    rerender({ subscriptionId: '99999999-2222-3333-8444-555555555555' })
    await waitFor(() => expect(result.current.phase).toBe('idle'))
    expect(signal?.aborted).toBe(true)
    resolvePost?.(RESPONSE)
    await Promise.resolve()
    expect(result.current.result).toBeNull()
  })

  it('does not reconcile a receipt against another subscription in the same Client', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    const otherState: BillingSubscriptionState = {
      ...STATE,
      current: { ...STATE.current, subscriptionId: '99999999-2222-3333-8444-555555555555' },
    }
    client.setQueryDefaults(billingSubscriptionKeys.state(CLIENT), { queryFn: async () => otherState })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockResolvedValue(RESPONSE)
    const { result } = renderHook(() => useSubscriptionTierChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) })
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })
    expect(result.current.phase).toBe('reconciliation_delayed')
  })

  it('ignores a late manual reconciliation after the attempt is cleared', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
    let hold = false
    let finish: (() => void) | undefined
    client.setQueryDefaults(billingSubscriptionKeys.state(CLIENT), {
      queryFn: async () => {
        if (!hold) throw new Error('temporarily unavailable')
        await new Promise<void>((resolve) => { finish = resolve })
        return STATE
      },
    })
    client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
    vi.spyOn(billingApi, 'getResourceAccessPreview').mockResolvedValue(PREVIEW)
    vi.spyOn(billingApi, 'postSubscriptionTierChange').mockResolvedValue(RESPONSE)
    const { result } = renderHook(() => useSubscriptionTierChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) })
    await act(async () => {
      await result.current.prepare({
        action: 'schedule', subscriptionTier: 'basic', expectedTierRevision: '7',
        effectivePolicy: 'next_billing_cycle', reason: 'Approved downgrade',
      }, STATE)
    })
    await act(async () => { await result.current.confirm(async () => STATE) })
    expect(result.current.phase).toBe('reconciliation_delayed')
    hold = true
    act(() => { void result.current.reconcile() })
    await waitFor(() => expect(result.current.phase).toBe('reconciling'))
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    act(() => result.current.clear())
    finish?.()
    await waitFor(() => expect(result.current.phase).toBe('idle'))
    expect(result.current.result).toBeNull()
  })
})
