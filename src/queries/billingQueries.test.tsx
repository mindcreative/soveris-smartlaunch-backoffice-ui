import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { billingApi, BillingContractError } from '../api/billingApi'
import type { BillingAccountSnapshot } from '../types/billing'
import {
  billingAccountKeys,
  clearPrivateBillingQueries,
  useBillingAccount,
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
  })

  it('cancels and removes all private Billing data', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(billingAccountKeys.account(CLIENT_A), snapshot(CLIENT_A))
    queryClient.setQueryData(['backoffice', 'public'], 'preserve')

    await clearPrivateBillingQueries(queryClient)

    expect(queryClient.getQueryData(billingAccountKeys.account(CLIENT_A))).toBeUndefined()
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
