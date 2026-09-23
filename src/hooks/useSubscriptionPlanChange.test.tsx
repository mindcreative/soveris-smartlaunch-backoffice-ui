import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as planApi from '../api/billingPlanApi'
import {
  billingAccountKeys,
  billingSubscriptionKeys,
} from '../queries/billingQueries'
import type {
  BillingAccountSnapshot,
  BillingSubscriptionPlanChangePreview,
  BillingSubscriptionScheduledPlanChangeReceipt,
  BillingSubscriptionState,
} from '../types/billing'
import { useSubscriptionPlanChange } from './useSubscriptionPlanChange'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const OPERATION = '01991f20-1234-7abc-8abc-1234567890ab'
const LOCAL = '2026-09-22T12:00:00.123456'
const TOKEN = `v1.${'a'.repeat(64)}`
const entitlements = { schemaVersion: 1 as const,
  rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
  featureFlags: { contentGeneration: true, imageGeneration: false } }
const STATE = { clientId: CLIENT, stateAsOf: LOCAL,
  current: { subscriptionId: SUBSCRIPTION, creationOperationId: OPERATION,
    planTermsOperationId: OPERATION, clientId: CLIENT, planName: 'Basic',
    subscriptionTier: 'brand' as const, tierRevision: '3', cycleCreditAmount: '1000.0000',
    entitlements, changeEffectivePolicy: 'immediate' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const, billingCycleAnchor: LOCAL, status: 'active' as const,
    validFrom: LOCAL, validTo: null, createdAt: LOCAL, updatedAt: LOCAL },
  pendingChange: null, subscriptionHistory: [],
  grantHistory: { items: [], historyAsOf: LOCAL, nextCursor: null },
} satisfies BillingSubscriptionState
const ACCOUNT = { creditAccountId: '22222222-2222-4333-8444-555555555555', clientId: CLIENT,
  ownedBalance: '100.0000', activelyReservedAmount: '0.0000', availableBalance: '100.0000',
  activeReservationCount: 0, status: 'active' as const, asOf: LOCAL, walletVersion: '4' } satisfies BillingAccountSnapshot
const REQUEST = { action: 'schedule' as const, planName: 'Pro', cycleCreditAmount: '1250.0000',
  entitlements, prorationPolicy: 'prorate' as const, unusedCreditPolicy: 'rollover' as const }
const PREVIEW = { schemaVersion: 1 as const, action: 'schedule' as const, previewToken: TOKEN,
  previewedAt: LOCAL, currentTerms: { planName: 'Basic', cycleCreditAmount: '1000.0000',
    entitlements, changeEffectivePolicy: 'immediate' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const },
  targetTerms: { planName: 'Pro', cycleCreditAmount: '1250.0000', entitlements,
    changeEffectivePolicy: 'next_billing_cycle' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const }, pendingChangeBefore: null,
  pendingResult: 'created' as const, effectiveCycle: { cycleIndex: 2, cycleStart: LOCAL,
    cycleEnd: '2026-10-22T12:00:00.123456' }, creditEffect: {
      timing: 'next_billing_cycle' as const, currentCycleCreditAmount: '1000.0000',
      targetCycleCreditAmount: '1250.0000', calculation: null, account: null },
  pendingImmediateDebitAfter: null } satisfies BillingSubscriptionPlanChangePreview
const RESULT_STATE = { ...STATE, pendingChange: { schemaVersion: 1,
  planChangeOperationId: OPERATION, planName: 'Pro', cycleCreditAmount: '1250.0000',
  entitlements, changeEffectivePolicy: 'next_billing_cycle' as const,
  prorationPolicy: 'prorate' as const, unusedCreditPolicy: 'rollover' as const,
  effectiveCycleIndex: 2, effectiveCycleStart: LOCAL,
  effectiveCycleEnd: '2026-10-22T12:00:00.123456', scheduledAt: LOCAL } }
const RECEIPT = { schemaVersion: 2 as const, planChangeOperationId: OPERATION,
  clientId: CLIENT, subscriptionId: SUBSCRIPTION, action: 'schedule' as const,
  previousPendingChangeOperationId: null, pendingChangeOperationId: OPERATION,
  planName: 'Pro', cycleCreditAmount: '1250.0000', entitlements,
  changeEffectivePolicy: 'next_billing_cycle' as const, prorationPolicy: 'prorate' as const,
  unusedCreditPolicy: 'rollover' as const, effectiveCycleIndex: 2,
  effectiveCycleStart: LOCAL, effectiveCycleEnd: '2026-10-22T12:00:00.123456',
  subscriptionTier: 'brand' as const, tierRevision: '3', operationAsOf: LOCAL,
} satisfies BillingSubscriptionScheduledPlanChangeReceipt

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
function queryClient(authorityRefresh: { fails: boolean } = { fails: false }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  client.setQueryDefaults(billingSubscriptionKeys.state(CLIENT), { queryFn: async () => {
    if (authorityRefresh.fails) throw new Error('subscription refresh unavailable')
    return RESULT_STATE
  } })
  client.setQueryDefaults(billingAccountKeys.account(CLIENT), { queryFn: async () => {
    if (authorityRefresh.fails) throw new Error('account refresh unavailable')
    return ACCOUNT
  } })
  client.setQueryData(billingSubscriptionKeys.state(CLIENT), STATE)
  client.setQueryData(billingAccountKeys.account(CLIENT), ACCOUNT)
  return client
}

describe('useSubscriptionPlanChange', () => {
  it('creates one UUIDv7 only after confirmation and replays identical retained bytes', async () => {
    const client = queryClient()
    vi.spyOn(planApi, 'previewBillingPlanChange').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(planApi, 'postBillingPlanChange')
      .mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(RECEIPT)
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(() => useSubscriptionPlanChange(CLIENT, SUBSCRIPTION, { uuidFactory }),
      { wrapper: wrapper(client) })
    await act(async () => { await result.current.prepare({ request: REQUEST,
      reason: 'Approved financial change' }, { subscription: STATE, account: ACCOUNT }) })
    expect(result.current.phase).toBe('confirmable')
    expect(uuidFactory).not.toHaveBeenCalled()
    await act(async () => { await result.current.confirm(async () => ({ subscription: STATE, account: ACCOUNT })) })
    expect(result.current.phase).toBe('unknown')
    expect(uuidFactory).toHaveBeenCalledTimes(1)
    const retained = result.current.attempt
    expect(retained?.serializedBody).toContain(`"planChangeOperationId":"${OPERATION}"`)
    expect(retained?.serializedBody).toContain(`"previewToken":"${TOKEN}"`)
    await act(async () => { await result.current.retry() })
    await waitFor(() => expect(result.current.phase).toBe('succeeded'))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[4]).toBe(post.mock.calls[0]?.[4])
    expect(post.mock.calls[1]?.[2]).toBe(post.mock.calls[0]?.[2])
    expect(result.current.attempt).toBe(retained)
  })

  it('rejects changed authority before allocating an operation identity', async () => {
    const client = queryClient()
    vi.spyOn(planApi, 'previewBillingPlanChange').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(planApi, 'postBillingPlanChange')
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(() => useSubscriptionPlanChange(CLIENT, SUBSCRIPTION, { uuidFactory }),
      { wrapper: wrapper(client) })
    await act(async () => { await result.current.prepare({ request: REQUEST,
      reason: 'Approved financial change' }, { subscription: STATE, account: ACCOUNT }) })
    await act(async () => { await result.current.confirm(async () => ({
      subscription: { ...STATE, current: { ...STATE.current!, updatedAt: '2026-09-22T12:01:00.123456' } },
      account: ACCOUNT,
    })) })
    expect(result.current.phase).toBe('rejected')
    expect(uuidFactory).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('single-flights duplicate confirmation activation', async () => {
    const client = queryClient()
    vi.spyOn(planApi, 'previewBillingPlanChange').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(planApi, 'postBillingPlanChange').mockResolvedValue(RECEIPT)
    const { result } = renderHook(() => useSubscriptionPlanChange(CLIENT, SUBSCRIPTION,
      { uuidFactory: () => OPERATION }), { wrapper: wrapper(client) })
    await act(async () => { await result.current.prepare({ request: REQUEST,
      reason: 'Approved financial change' }, { subscription: STATE, account: ACCOUNT }) })
    await act(async () => { await Promise.all([
      result.current.confirm(async () => ({ subscription: STATE, account: ACCOUNT })),
      result.current.confirm(async () => ({ subscription: STATE, account: ACCOUNT })),
    ]) })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('purges client-scoped facts when a preview violates the financial contract', async () => {
    const client = queryClient()
    vi.spyOn(planApi, 'previewBillingPlanChange').mockRejectedValue(
      new planApi.BillingPlanContractError('preview fields are invalid'))
    const { result } = renderHook(() => useSubscriptionPlanChange(CLIENT, SUBSCRIPTION),
      { wrapper: wrapper(client) })

    await act(async () => { await result.current.prepare({ request: REQUEST,
      reason: 'Approved financial change' }, { subscription: STATE, account: ACCOUNT }) })

    expect(result.current.phase).toBe('idle')
    expect(result.current.confirmation).toBeNull()
    expect(result.current.attempt).toBeNull()
    expect(result.current.result).toBeNull()
    expect(client.getQueryData(billingSubscriptionKeys.state(CLIENT))).toBeUndefined()
    expect(client.getQueryData(billingAccountKeys.account(CLIENT))).toBeUndefined()
  })

  it('keeps a completed command in delayed reconciliation when mounted authority refreshes fail', async () => {
    const authorityRefresh = { fails: false }
    const client = queryClient(authorityRefresh)
    vi.spyOn(planApi, 'previewBillingPlanChange').mockResolvedValue(PREVIEW)
    vi.spyOn(planApi, 'postBillingPlanChange').mockResolvedValue(RECEIPT)
    const { result } = renderHook(() => useSubscriptionPlanChange(CLIENT, SUBSCRIPTION,
      { uuidFactory: () => OPERATION }), { wrapper: wrapper(client) })

    await act(async () => { await result.current.prepare({ request: REQUEST,
      reason: 'Approved financial change' }, { subscription: STATE, account: ACCOUNT }) })
    authorityRefresh.fails = true

    await act(async () => { await result.current.confirm(async () => ({
      subscription: STATE, account: ACCOUNT,
    })) })
    expect(result.current.result).toEqual(RECEIPT)
    expect(result.current.phase).toBe('reconciliation_delayed')

    await act(async () => { await result.current.reconcile() })
    expect(result.current.phase).toBe('reconciliation_delayed')
  })
})
