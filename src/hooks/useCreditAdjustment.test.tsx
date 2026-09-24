import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as adjustmentApi from '../api/billingAdjustmentApi'
import { billingApi } from '../api/billingApi'
import { billingAdjustmentKeys } from '../queries/billingQueries'
import { creditAdjustmentRecoveryStore } from '../stores/creditAdjustmentRecoveryStore'
import type {
  BillingAccountSnapshot,
  CreditAdjustmentHistoryItem,
  CreditAdjustmentPreview,
  CreditAdjustmentReceipt,
} from '../types/billing'
import { useCreditAdjustment } from './useCreditAdjustment'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const OPERATION = '0199b9d2-a9b1-7000-8000-000000000001'
const ADJUSTMENT = '0199b9d2-a9b1-7000-8000-000000000003'
const LEDGER = '0199b9d2-a9b1-7000-8000-000000000004'
const AT = '2026-09-24T12:00:00.123456Z'

const PREVIEW: CreditAdjustmentPreview = {
  schemaVersion: 1, clientId: CLIENT, creditAccountId: ACCOUNT_ID, walletVersion: '12', asOf: AT,
  amount: '-25.5000', reason: 'Correction', currentOwnedBalance: '100.0000',
  currentReservedBalance: '20.0000', currentAvailableBalance: '80.0000',
  projectedOwnedBalance: '74.5000', projectedReservedBalance: '20.0000',
  projectedAvailableBalance: '54.5000', maximumSafeDebit: '80.0000',
  minimumAllowedAmount: '-80.0000', walletInvariantEligible: true, ineligibilityCode: null,
}
const RECEIPT: CreditAdjustmentReceipt = {
  schemaVersion: 1, operationId: OPERATION, adjustmentId: ADJUSTMENT, ledgerId: LEDGER,
  clientId: CLIENT, creditAccountId: ACCOUNT_ID, amount: '-25.5000', reason: 'Correction',
  performedBy: ACTOR, walletVersionBefore: '12', walletVersionAfter: '13',
  beforeOwnedBalance: '100.0000', beforeReservedBalance: '20.0000',
  beforeAvailableBalance: '80.0000', afterOwnedBalance: '74.5000',
  afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000', operationAsOf: AT,
}
const HISTORY_ITEM: CreditAdjustmentHistoryItem = {
  ...RECEIPT, operationType: 'original', expectedWalletVersion: '12',
  originalAdjustmentId: null, reversalAdjustmentId: null,
}
const ACCOUNT: BillingAccountSnapshot = {
  creditAccountId: ACCOUNT_ID, clientId: CLIENT, ownedBalance: '74.5000',
  activelyReservedAmount: '20.0000', availableBalance: '54.5000', activeReservationCount: 1,
  status: 'active', asOf: '2026-09-24T12:01:00.000000', walletVersion: '13',
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function renderWorkflow(queryClient = client(), accountDataUpdatedAt = 1) {
  return renderHook(
    ({ updatedAt }) => useCreditAdjustment({
      clientId: CLIENT, creditAccountId: ACCOUNT_ID, actorUserId: ACTOR,
      authorized: true, accountDataUpdatedAt: updatedAt, uuidFactory: () => OPERATION,
      now: () => new Date('2026-09-24T12:00:01Z'),
    }),
    { initialProps: { updatedAt: accountDataUpdatedAt }, wrapper: wrapper(queryClient) }
  )
}

async function enterAndPreview(result: ReturnType<typeof renderWorkflow>['result']) {
  act(() => { result.current.setAmount('-25.5000'); result.current.setReason('Correction') })
  await act(async () => { await result.current.requestPreview() })
}

afterEach(() => {
  vi.restoreAllMocks()
  creditAdjustmentRecoveryStore.clearForTests()
})

describe('useCreditAdjustment', () => {
  it('invalidates reviewed evidence on edits, Cancel, and account refresh while preserving inputs', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const hook = renderWorkflow()
    await enterAndPreview(hook.result)
    expect(hook.result.current.phase).toBe('review')
    act(() => hook.result.current.cancelReview())
    expect(hook.result.current.phase).toBe('editing')
    expect(hook.result.current.amount).toBe('-25.5000')
    expect(hook.result.current.reason).toBe('Correction')
    await act(async () => { await hook.result.current.requestPreview() })
    act(() => hook.result.current.setReason('Corrected reason'))
    expect(hook.result.current.preview).toBeNull()
    expect(hook.result.current.phase).toBe('editing')
    act(() => hook.result.current.setReason('Correction'))
    await act(async () => { await hook.result.current.requestPreview() })
    hook.rerender({ updatedAt: 2 })
    expect(hook.result.current.phase).toBe('editing')
    expect(hook.result.current.amount).toBe('-25.5000')
  })

  it('creates one UUID only after an identical fresh preview and single-flights confirmation', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockResolvedValue(RECEIPT)
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockResolvedValue({
      items: [HISTORY_ITEM], asOf: AT, nextCursor: null,
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const uuidFactory = vi.fn(() => OPERATION)
    const queryClient = client()
    const { result } = renderHook(() => useCreditAdjustment({
      clientId: CLIENT, creditAccountId: ACCOUNT_ID, actorUserId: ACTOR,
      authorized: true, accountDataUpdatedAt: 1, uuidFactory,
      now: () => new Date('2026-09-24T12:00:01Z'),
    }), { wrapper: wrapper(queryClient) })
    await enterAndPreview(result)
    await act(async () => { await Promise.all([result.current.confirm(), result.current.confirm()]) })
    expect(uuidFactory).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[4]).toContain(`"operationId":"${OPERATION}"`)
    expect(result.current.phase).toBe('success')
    expect(result.current.receipt).toEqual(RECEIPT)
    expect(result.current.accountRefreshFailed).toBe(false)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)).toBeNull()
  })

  it('allocates no identity when confirm-time evidence changed or moved backwards', async () => {
    const preview = vi.spyOn(adjustmentApi, 'previewCreditAdjustment')
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({ ...PREVIEW, walletVersion: '13' })
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustment')
    const uuidFactory = vi.fn(() => OPERATION)
    const { result } = renderHook(() => useCreditAdjustment({
      clientId: CLIENT, creditAccountId: ACCOUNT_ID, actorUserId: ACTOR,
      authorized: true, accountDataUpdatedAt: 1, uuidFactory,
    }), { wrapper: wrapper(client()) })
    await enterAndPreview(result)
    await act(async () => { await result.current.confirm() })
    expect(preview).toHaveBeenCalledTimes(2)
    expect(uuidFactory).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('rejected')
    expect(result.current.attempt).toBeNull()
  })

  it('keeps one ambiguous identity across unmount/remount and retries byte-identically', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustment')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Connection lost' })
      .mockResolvedValueOnce(RECEIPT)
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation')
      .mockResolvedValueOnce({ items: [], asOf: AT, nextCursor: null })
      .mockResolvedValueOnce({ items: [], asOf: AT, nextCursor: null })
      .mockResolvedValueOnce({ items: [HISTORY_ITEM], asOf: AT, nextCursor: null })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const queryClient = client()
    const first = renderWorkflow(queryClient)
    await enterAndPreview(first.result)
    await act(async () => { await first.result.current.confirm() })
    expect(first.result.current.phase).toBe('unknown')
    const retained = creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)
    expect(retained).not.toBeNull()
    first.unmount()
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)?.quarantined).toBe(true)

    const restored = renderWorkflow(queryClient)
    await waitFor(() => expect(restored.result.current.phase).toBe('unknown'))
    expect(restored.result.current.attempt?.operationId).toBe(OPERATION)
    await act(async () => { await restored.result.current.retry() })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[4]).toBe(post.mock.calls[0]?.[4])
    expect(restored.result.current.phase).toBe('success')
  })

  it('preserves a routine preview authentication replay without clearing reviewed input', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockImplementation(
      async (_clientId, _creditAccountId, _request, _signal, onAuthReplay) => {
        onAuthReplay?.()
        window.dispatchEvent(new CustomEvent('auth:refreshed'))
        return PREVIEW
      })
    const workflow = renderWorkflow()

    await enterAndPreview(workflow.result)

    expect(workflow.result.current.phase).toBe('review')
    expect(workflow.result.current.amount).toBe('-25.5000')
    expect(workflow.result.current.reason).toBe('Correction')
  })

  it('keeps unexpected post-dispatch 4xx outcomes ambiguous under the sealed identity', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockRejectedValue({
      code: 'HTTP_408', status: 408, message: 'Request timeout',
    })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockResolvedValue({
      items: [], asOf: AT, nextCursor: null,
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const workflow = renderWorkflow()
    await enterAndPreview(workflow.result)

    await act(async () => { await workflow.result.current.confirm() })

    expect(workflow.result.current.phase).toBe('unknown')
    expect(workflow.result.current.attempt?.operationId).toBe(OPERATION)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)?.operationId).toBe(OPERATION)
  })

  it('treats receipt balances that do not match reviewed evidence as ambiguous', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockResolvedValue({
      ...RECEIPT,
      beforeOwnedBalance: '200.0000', beforeAvailableBalance: '180.0000',
      afterOwnedBalance: '174.5000', afterAvailableBalance: '154.5000',
    })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockResolvedValue({
      items: [], asOf: AT, nextCursor: null,
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const workflow = renderWorkflow()
    await enterAndPreview(workflow.result)

    await act(async () => { await workflow.result.current.confirm() })

    expect(workflow.result.current.phase).toBe('unknown')
    expect(workflow.result.current.receipt).toBeNull()
  })

  it('purges adjustment mutations on unmount and final permission denial', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const firstClient = client()
    const first = renderWorkflow(firstClient)
    firstClient.getMutationCache().build(firstClient, {
      mutationKey: billingAdjustmentKeys.preview(CLIENT),
      mutationFn: async () => ({ reason: 'private' }),
    })
    expect(firstClient.getMutationCache().getAll()).not.toHaveLength(0)
    first.unmount()
    await waitFor(() => expect(firstClient.getMutationCache().getAll()).toHaveLength(0))

    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockRejectedValue({
      code: 'HTTP_403', status: 403, message: 'Denied',
    })
    const deniedClient = client()
    const onPermissionDenied = vi.fn()
    const denied = renderHook(() => useCreditAdjustment({
      clientId: CLIENT, creditAccountId: ACCOUNT_ID, actorUserId: ACTOR,
      authorized: true, accountDataUpdatedAt: 1, uuidFactory: () => OPERATION,
      onPermissionDenied,
    }), { wrapper: wrapper(deniedClient) })
    await enterAndPreview(denied.result)
    await act(async () => { await denied.result.current.confirm() })
    expect(onPermissionDenied).toHaveBeenCalledOnce()
    expect(deniedClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('fails closed and quarantines when ambiguity reconciliation loses authorization', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockRejectedValue({
      code: 'NETWORK_ERROR', message: 'Connection lost',
    })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockRejectedValue({
      code: 'HTTP_403', status: 403, message: 'Denied',
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const onPermissionDenied = vi.fn()
    const queryClient = client()
    const workflow = renderHook(() => useCreditAdjustment({
      clientId: CLIENT, creditAccountId: ACCOUNT_ID, actorUserId: ACTOR,
      authorized: true, accountDataUpdatedAt: 1, uuidFactory: () => OPERATION,
      onPermissionDenied,
    }), { wrapper: wrapper(queryClient) })
    await enterAndPreview(workflow.result)

    await act(async () => { await workflow.result.current.confirm() })

    expect(onPermissionDenied).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }))
    expect(workflow.result.current.phase).toBe('editing')
    expect(workflow.result.current.attempt).toBeNull()
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)?.quarantined).toBe(true)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('accepts an exact history row as commit evidence without replaying the command', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustment')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Connection lost' })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentOperation').mockResolvedValue({
      items: [HISTORY_ITEM], asOf: AT, nextCursor: null,
    })
    vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
    const workflow = renderWorkflow()
    await enterAndPreview(workflow.result)

    await act(async () => { await workflow.result.current.confirm() })

    expect(post).toHaveBeenCalledOnce()
    expect(workflow.result.current.phase).toBe('success')
    expect(workflow.result.current.receipt).toEqual(RECEIPT)
    expect(workflow.result.current.historyReconciled).toBe(true)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)).toBeNull()
  })

  it('retires a final authorization denial and quarantines local authority loss', async () => {
    vi.spyOn(adjustmentApi, 'previewCreditAdjustment').mockResolvedValue(PREVIEW)
    vi.spyOn(adjustmentApi, 'postCreditAdjustment').mockRejectedValue({
      code: 'HTTP_403', status: 403, message: 'Denied',
    })
    const denied = renderWorkflow()
    await enterAndPreview(denied.result)
    await act(async () => { await denied.result.current.confirm() })
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)).toBeNull()
    expect(denied.result.current.phase).toBe('editing')

    creditAdjustmentRecoveryStore.retain({
      actorUserId: ACTOR, clientId: CLIENT, creditAccountId: ACCOUNT_ID,
      route: `/api/billing/clients/${CLIENT}/credit-adjustments`, operationId: OPERATION,
      request: { operationId: OPERATION, expectedWalletVersion: '12', amount: '-25.5000', reason: 'Correction' },
      serializedBody: 'sealed', semanticFingerprint: 'private', dispatchedAt: AT,
    })
    act(() => window.dispatchEvent(new CustomEvent('auth:cleared')))
    expect(creditAdjustmentRecoveryStore.peek(ACTOR, CLIENT)?.quarantined).toBe(true)
  })
})
