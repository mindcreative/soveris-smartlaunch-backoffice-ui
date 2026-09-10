import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  billingApi,
  BillingContractError,
  BillingLedgerContractError,
  BillingSubscriptionContractError,
} from '../api/billingApi'
import type { BillingAccountSnapshot, BillingLedgerPage, BillingSubscriptionState } from '../types/billing'
import {
  billingAccountKeys,
  billingExportKeys,
  billingLedgerKeys,
  billingSubscriptionKeys,
  clearPrivateBillingQueries,
  useBillingAccount,
  useBillingLedger,
  useBillingSubscriptions,
} from './billingQueries'

const CLIENT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const CLIENT_B = 'ffffffff-1111-2222-3333-444444444444'

function snapshot(clientId: string): BillingAccountSnapshot {
  return {
    creditAccountId: '11111111-2222-3333-4444-555555555555',
    clientId,
    ownedBalance: clientId === CLIENT_A ? '10.0000' : '20.0000',
    activelyReservedAmount: '0.0000',
    availableBalance: clientId === CLIENT_A ? '10.0000' : '20.0000',
    activeReservationCount: 0,
    status: 'active',
    asOf: '2026-08-24T07:00:00+00:00',
    walletVersion: '1',
  }
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('private Billing queries', () => {
  it('uses private Client-scoped resource keys', () => {
    expect(billingAccountKeys.account(CLIENT_A)).toEqual([
      'backoffice',
      'private',
      'billing',
      'account',
      CLIENT_A,
    ])
    expect(billingExportKeys.detail(CLIENT_A, 'export-id')).toEqual([
      'backoffice', 'private', 'billing', 'exports', CLIENT_A, 'export-id',
    ])
    expect(billingExportKeys.request(CLIENT_A)).toEqual([
      'backoffice', 'private', 'billing', 'exports', CLIENT_A, 'request',
    ])
    expect(billingSubscriptionKeys.state(CLIENT_A)).toEqual([
      'backoffice', 'private', 'billing', 'subscriptions', CLIENT_A, 'state',
    ])
    expect(billingSubscriptionKeys.create(CLIENT_A)).toEqual([
      'backoffice', 'private', 'billing', 'subscriptions', CLIENT_A, 'create',
    ])
    expect(billingSubscriptionKeys.lifecycle(CLIENT_A, 'subscription-id')).toEqual([
      'backoffice', 'private', 'billing', 'subscriptions', CLIENT_A,
      'subscription-id', 'lifecycle',
    ])
  })

  it('cancels and removes all private Billing data', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_A), snapshot(CLIENT_A))
    queryClient.setQueryData(billingExportKeys.detail(CLIENT_A, 'export-id'), { status: 'pending' })
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: billingExportKeys.request(CLIENT_A),
      mutationFn: async () => ({ exportId: 'export-id' }),
    })
    queryClient.setQueryData(billingSubscriptionKeys.state(CLIENT_A), { clientId: CLIENT_A })
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: billingSubscriptionKeys.create(CLIENT_A),
      mutationFn: async () => ({ created: true }),
    })
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: billingSubscriptionKeys.lifecycle(CLIENT_A, 'subscription-id'),
      mutationFn: async () => ({ status: 'paused' }),
    })
    queryClient.setQueryData(['backoffice', 'public'], 'preserve')

    await clearPrivateBillingQueries(queryClient)

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
    expect(queryClient.getQueryData(billingExportKeys.detail(CLIENT_A, 'export-id'))).toBeUndefined()
    expect(queryClient.getQueryData(billingSubscriptionKeys.state(CLIENT_A))).toBeUndefined()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(queryClient.getQueryData(['backoffice', 'public'])).toBe('preserve')
  })

  it('removes the former Client before accepting a late response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let resolveA: ((value: BillingAccountSnapshot) => void) | undefined
    let signalA: AbortSignal | undefined
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockImplementation((clientId, signal) => {
      if (clientId === CLIENT_A) {
        signalA = signal
        return new Promise((resolve) => {
          resolveA = resolve
        })
      }
      return Promise.resolve(snapshot(CLIENT_B))
    })

    const { result, rerender } = renderHook(
      ({ clientId }) => useBillingAccount(clientId),
      { initialProps: { clientId: CLIENT_A }, wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(request).toHaveBeenCalledWith(CLIENT_A, expect.any(AbortSignal)))
    rerender({ clientId: CLIENT_B })

    await waitFor(() => expect(result.current.data?.clientId).toBe(CLIENT_B))
    expect(signalA?.aborted).toBe(true)
    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()

    resolveA?.(snapshot(CLIENT_A))
    await Promise.resolve()

    expect(result.current.data?.clientId).toBe(CLIENT_B)
    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
  })

  it('removes a cached snapshot after a malformed same-Client response', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_A), snapshot(CLIENT_A))
    vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue(
      new BillingContractError('payload fields do not match the closed contract')
    )

    const { result } = renderHook(() => useBillingAccount(CLIENT_A), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() => {
      expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
    })
  })

  it('removes a cached snapshot when the account becomes not configured', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_A), snapshot(CLIENT_A))
    vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_404', message: 'Credit account not configured', status: 404,
    })

    const { result } = renderHook(() => useBillingAccount(CLIENT_A), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() => {
      expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
    })
  })

  it('treats 429 as transient and retries it once', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const request = vi.spyOn(billingApi, 'getAccountSnapshot').mockRejectedValue({
      code: 'HTTP_429', message: 'Retry later', status: 429,
    })

    const { result } = renderHook(() => useBillingAccount(CLIENT_A), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(2)
  })
})

function subscriptionState(clientId: string): BillingSubscriptionState {
  return {
    clientId,
    stateAsOf: '2026-09-06T12:00:00+00:00',
    current: null,
    pendingChange: null,
    subscriptionHistory: [],
    grantHistory: {
      items: [], historyAsOf: '2026-09-06T12:00:00+00:00', nextCursor: null,
    },
  }
}

describe('private Billing subscription queries', () => {
  it('cancels and removes the former Client before accepting a late response', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let resolveA: ((value: BillingSubscriptionState) => void) | undefined
    let signalA: AbortSignal | undefined
    const request = vi.spyOn(billingApi, 'getSubscriptionState').mockImplementation(
      (clientId, _request, signal) => {
        if (clientId === CLIENT_A) {
          signalA = signal
          return new Promise((resolve) => { resolveA = resolve })
        }
        return Promise.resolve(subscriptionState(CLIENT_B))
      }
    )
    const { result, rerender } = renderHook(
      ({ clientId }) => useBillingSubscriptions(clientId),
      { initialProps: { clientId: CLIENT_A }, wrapper: createWrapper(queryClient) }
    )
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      CLIENT_A, { pageSize: 20 }, expect.any(AbortSignal)
    ))
    rerender({ clientId: CLIENT_B })
    await waitFor(() => expect(result.current.data?.clientId).toBe(CLIENT_B))
    expect(signalA?.aborted).toBe(true)
    expect(queryClient.getQueryData(billingSubscriptionKeys.state(CLIENT_A))).toBeUndefined()
    resolveA?.(subscriptionState(CLIENT_A))
    await Promise.resolve()
    expect(result.current.data?.clientId).toBe(CLIENT_B)
  })

  it('fails closed and removes malformed subscription state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(billingApi, 'getSubscriptionState').mockRejectedValue(
      new BillingSubscriptionContractError('state fields do not match the closed contract')
    )
    const { result } = renderHook(() => useBillingSubscriptions(CLIENT_A), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() => {
      expect(queryClient.getQueryData(billingSubscriptionKeys.state(CLIENT_A))).toBeUndefined()
    })
  })

  it('loads bounded grant continuations and rejects duplicate evidence', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = subscriptionState(CLIENT_A)
    first.grantHistory.nextCursor = 'next'
    const grant = {
      grantId: '33333333-3333-4333-8333-555555555555',
      grantOperationId: '01991f20-2234-7abc-8abc-1234567890ab',
      subscriptionId: '22222222-2222-3333-8444-555555555555',
      planTermsOperationId: '01991f20-1234-7abc-8abc-1234567890ab',
      planNameSnapshot: 'Pro',
      subscriptionTierSnapshot: 'brand' as const,
      tierRevisionSnapshot: '0',
      entitlementsSnapshot: {
        schemaVersion: 1 as const,
        rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
        featureFlags: { contentGeneration: true, imageGeneration: false },
      },
      grantType: 'billing_cycle' as const,
      cycleStart: '2026-02-15T12:00:00.000000Z', cycleEnd: '2026-03-15T12:00:00.000000Z',
      creditAmount: '1250.0000', ledgerEntryId: '44444444-4444-4444-8444-555555555555',
      createdAt: '2026-02-15T12:00:01.000000Z',
    }
    const next = subscriptionState(CLIENT_A)
    next.grantHistory = { items: [grant], historyAsOf: first.grantHistory.historyAsOf, nextCursor: null }
    const request = vi.spyOn(billingApi, 'getSubscriptionState')
      .mockResolvedValueOnce(first).mockResolvedValueOnce(next)
    const { result } = renderHook(() => useBillingSubscriptions(CLIENT_A), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await result.current.loadMore()
    await waitFor(() => expect(result.current.data?.grantHistory.items).toEqual([grant]))
    expect(request).toHaveBeenLastCalledWith(CLIENT_A, { cursor: 'next' }, expect.any(AbortSignal))

    first.grantHistory.items = [grant]
    first.grantHistory.nextCursor = 'duplicate'
    request.mockResolvedValueOnce({
      ...next, grantHistory: { ...next.grantHistory, items: [grant] },
    })
    await queryClient.setQueryData(billingSubscriptionKeys.state(CLIENT_A), first)
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await expect(result.current.loadMore()).rejects.toThrow('duplicate grant')
  })
})

function ledgerPage(
  ledgerId: string,
  nextCursor: string | null,
  asOf = '2026-08-24T08:00:00+00:00'
): BillingLedgerPage {
  return {
    items: [{
      ledgerId,
      creditAccountId: '11111111-2222-3333-4444-555555555555',
      jobId: null,
      reservationId: null,
      adjustmentId: null,
      operationId: '88888888-8888-8888-8888-888888888888',
      transactionType: 'subscription_grant',
      amount: '10.0000',
      balanceAfter: '10.0000',
      ruleId: null,
      ruleVersion: null,
      actorUserId: null,
      reason: null,
      createdAt: '2026-08-24T07:00:00+00:00',
    }],
    asOf,
    nextCursor,
  }
}

describe('private Billing ledger traversal', () => {
  it('uses a private Client/filter/fresh-traversal key', () => {
    expect(billingLedgerKeys.traversal(CLIENT_A, { transactionType: 'promotion' }, 7)).toEqual([
      'backoffice', 'private', 'billing', 'ledger', CLIENT_A,
      { transactionType: 'promotion' }, 7,
    ])
  })

  it('uses initial filters then cursor-only continuation and preserves order', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'next'))
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777778', null))
    const { result } = renderHook(
      () => useBillingLedger(CLIENT_A, { transactionType: 'promotion' }, 1),
      { wrapper: createWrapper(queryClient) }
    )

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    await result.current.loadMore()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    expect(request.mock.calls[0]?.[1]).toEqual({ filters: { transactionType: 'promotion' } })
    expect(request.mock.calls[1]?.[1]).toEqual({ cursor: 'next' })
    expect(result.current.items.map((item) => item.ledgerId)).toEqual([
      '77777777-7777-7777-7777-777777777779',
      '77777777-7777-7777-7777-777777777778',
    ])
  })

  it('rejects a continuation with a different watermark or duplicate row', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'next'))
      .mockResolvedValueOnce(ledgerPage(
        '77777777-7777-7777-7777-777777777778',
        null,
        '2026-08-24T09:00:00+00:00'
      ))
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))

    await result.current.loadMore()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current.error?.message).toContain('active snapshot')
    expect(queryClient.getQueryData(billingLedgerKeys.traversal(CLIENT_A, {}, 1))).toBeUndefined()
  })

  it('gates rapid duplicate load-more activation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let release: ((page: BillingLedgerPage) => void) | undefined
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'next'))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))

    const first = result.current.loadMore()
    const second = result.current.loadMore()
    expect(request).toHaveBeenCalledTimes(2)
    release?.(ledgerPage('77777777-7777-7777-7777-777777777778', null))
    await Promise.all([first, second])
  })

  it('retains validated rows through a later transient failure and retries the same cursor', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'same-cursor'))
      .mockRejectedValueOnce({ code: 'HTTP_500', message: 'Unavailable', status: 500 })
      .mockRejectedValueOnce({ code: 'HTTP_500', message: 'Unavailable', status: 500 })
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await result.current.loadMore()
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true))
    expect(result.current.items).toHaveLength(1)
    expect(request.mock.calls[1]?.[1]).toEqual({ cursor: 'same-cursor' })
    expect(request.mock.calls[2]?.[1]).toEqual({ cursor: 'same-cursor' })

    request.mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777778', null))
    await result.current.loadMore()
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(request.mock.calls[3]?.[1]).toEqual({ cursor: 'same-cursor' })
  })

  it.each([
    { code: 'HTTP_429', message: 'Rate limited', status: 429 },
    { code: 'NETWORK_ERROR', message: 'Network unavailable' },
  ])('retains rows and retries a later $code failure', async (failure) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'same-cursor'))
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await result.current.loadMore()

    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true))
    expect(result.current.items).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[1]?.[1]).toEqual({ cursor: 'same-cursor' })
    expect(request.mock.calls[2]?.[1]).toEqual({ cursor: 'same-cursor' })
  })

  it('removes a duplicate continuation instead of silently de-duplicating evidence', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'next'))
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', null))
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await result.current.loadMore()

    await waitFor(() => expect(result.current.error).toBeInstanceOf(BillingLedgerContractError))
    await waitFor(() => expect(
      queryClient.getQueryData(billingLedgerKeys.traversal(CLIENT_A, {}, 1))
    ).toBeUndefined())
  })

  it('does not request another page after the server ends the traversal', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockResolvedValue(ledgerPage(
      '77777777-7777-7777-7777-777777777779', null
    ))
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    await result.current.loadMore()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('cancels and removes a superseded filter traversal before a late response can append', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let resolveOld: ((page: BillingLedgerPage) => void) | undefined
    let oldSignal: AbortSignal | undefined
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockImplementation(
      (_clientId, requestPage, signal) => {
        if (requestPage.filters && requestPage.filters.transactionType !== 'promotion') {
          oldSignal = signal
          return new Promise((resolve) => { resolveOld = resolve })
        }
        return Promise.resolve(ledgerPage('77777777-7777-7777-7777-777777777778', null))
      }
    )
    const { result, rerender } = renderHook(
      ({ filters, traversalId }) => useBillingLedger(CLIENT_A, filters, traversalId),
      {
        initialProps: { filters: {}, traversalId: 1 },
        wrapper: createWrapper(queryClient),
      }
    )
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    rerender({ filters: { transactionType: 'promotion' }, traversalId: 2 })
    await waitFor(() => expect(result.current.items[0]?.ledgerId).toBe(
      '77777777-7777-7777-7777-777777777778'
    ))
    expect(oldSignal?.aborted).toBe(true)
    expect(queryClient.getQueryData(billingLedgerKeys.traversal(CLIENT_A, {}, 1))).toBeUndefined()

    resolveOld?.(ledgerPage('77777777-7777-7777-7777-777777777779', null))
    await Promise.resolve()
    expect(result.current.items.map((item) => item.ledgerId)).toEqual([
      '77777777-7777-7777-7777-777777777778',
    ])
  })

  it.each([400, 401, 403])('does not retry an initial HTTP %s ledger failure', async (status) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockRejectedValue({
      code: `HTTP_${status}`, message: 'Safe failure', status,
    })
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.items).toEqual([])
  })

  it.each([429, 500])('retries an initial transient HTTP %s ledger failure once', async (status) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockRejectedValue({
      code: `HTTP_${status}`, message: 'Safe transient failure', status,
    })
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries an initial network failure once', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockRejectedValue({
      code: 'NETWORK_ERROR', message: 'Network unavailable',
    })
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not retry an initial contract failure and removes the traversal', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = vi.spyOn(billingApi, 'getLedgerPage').mockRejectedValue(
      new BillingLedgerContractError('closed contract mismatch')
    )
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(queryClient.getQueryData(
      billingLedgerKeys.traversal(CLIENT_A, {}, 1)
    )).toBeUndefined())
  })

  it('removes all private Billing data and suppresses rows on a later authorization failure', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_B), snapshot(CLIENT_B))
    vi.spyOn(billingApi, 'getLedgerPage')
      .mockResolvedValueOnce(ledgerPage('77777777-7777-7777-7777-777777777779', 'next'))
      .mockRejectedValueOnce({ code: 'HTTP_403', message: 'Denied', status: 403 })
    const { result } = renderHook(() => useBillingLedger(CLIENT_A, {}, 1), {
      wrapper: createWrapper(queryClient),
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await result.current.loadMore()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(queryClient.getQueryCache().findAll({
      queryKey: billingAccountKeys.billing,
    })).toHaveLength(0))
  })
})
