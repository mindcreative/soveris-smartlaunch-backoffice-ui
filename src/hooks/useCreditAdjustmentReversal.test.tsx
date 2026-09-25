import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as adjustmentApi from '../api/billingAdjustmentApi'
import { billingApi } from '../api/billingApi'
import { billingAdjustmentKeys } from '../queries/billingQueries'
import { creditAdjustmentReversalRecoveryStore } from '../stores/creditAdjustmentReversalRecoveryStore'
import type {
  BillingAccountSnapshot,
  CreditAdjustmentFamily,
  CreditAdjustmentHistoryOriginalItem,
  CreditAdjustmentHistoryReversalItem,
  CreditAdjustmentReversalReceipt,
} from '../types/billing'
import { useCreditAdjustmentReversal } from './useCreditAdjustmentReversal'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT_ID = '0199b9d2-a9b1-7000-8000-000000000002'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const ORIGINAL_ID = '0199b9d2-a9b1-7000-8000-000000000003'
const OPERATION = '0199b9d2-a9b1-7000-8000-000000000005'
const REVERSAL_ID = '0199b9d2-a9b1-7000-8000-000000000006'
const LOCAL_AT = '2026-09-24T14:00:00.123456'

const ORIGINAL: CreditAdjustmentHistoryOriginalItem = {
  schemaVersion: 1, clientId: CLIENT, creditAccountId: ACCOUNT_ID,
  operationId: '0199b9d2-a9b1-7000-8000-000000000001', adjustmentId: ORIGINAL_ID,
  ledgerId: '0199b9d2-a9b1-7000-8000-000000000004', operationType: 'original',
  amount: '-25.5000', reason: 'Original correction', performedBy: ACTOR,
  expectedWalletVersion: '12', walletVersionBefore: '12', walletVersionAfter: '13',
  beforeOwnedBalance: '100.0000', beforeReservedBalance: '20.0000',
  beforeAvailableBalance: '80.0000', afterOwnedBalance: '74.5000',
  afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000',
  operationAsOf: '2026-09-24T13:00:00.123456',
  originalAdjustmentId: null, reversalAdjustmentId: null,
}
const ACCOUNT: BillingAccountSnapshot = {
  creditAccountId: ACCOUNT_ID, clientId: CLIENT, ownedBalance: '74.5000',
  activelyReservedAmount: '20.0000', availableBalance: '54.5000',
  activeReservationCount: 1, status: 'active', asOf: LOCAL_AT, walletVersion: '13',
}
const FAMILY: CreditAdjustmentFamily = { original: ORIGINAL, reversal: null, asOf: LOCAL_AT }
const REVERSAL: CreditAdjustmentHistoryReversalItem = {
  ...ORIGINAL, operationId: OPERATION, adjustmentId: REVERSAL_ID,
  ledgerId: '0199b9d2-a9b1-7000-8000-000000000007', operationType: 'reversal',
  amount: '25.5000', reason: 'Compensate correction', expectedWalletVersion: '13',
  walletVersionBefore: '13', walletVersionAfter: '14',
  beforeOwnedBalance: '74.5000', beforeAvailableBalance: '54.5000',
  afterOwnedBalance: '100.0000', afterAvailableBalance: '80.0000',
  operationAsOf: '2026-09-24T15:00:00.123456',
  originalAdjustmentId: ORIGINAL_ID, reversalAdjustmentId: null,
}
const RECEIPT: CreditAdjustmentReversalReceipt = {
  schemaVersion: 1, operationId: OPERATION, originalAdjustmentId: ORIGINAL_ID,
  reversalAdjustmentId: REVERSAL_ID,
  reversalLedgerId: '0199b9d2-a9b1-7000-8000-000000000007',
  clientId: CLIENT, creditAccountId: ACCOUNT_ID, compensatingAmount: '25.5000',
  reason: 'Compensate correction', performedBy: ACTOR,
  walletVersionBefore: '13', walletVersionAfter: '14',
  beforeOwnedBalance: '74.5000', beforeReservedBalance: '20.0000',
  beforeAvailableBalance: '54.5000', afterOwnedBalance: '100.0000',
  afterReservedBalance: '20.0000', afterAvailableBalance: '80.0000',
  operationAsOf: '2026-09-24T15:00:00.123456',
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}
function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
function renderWorkflow(queryClient = client(), canAdjust = true) {
  const onPermissionDenied = vi.fn()
  const hook = renderHook(
    ({ allowed }) => useCreditAdjustmentReversal({
      clientId: CLIENT, actorUserId: ACTOR, canAdjust: allowed, canView: true,
      uuidFactory: () => OPERATION, now: () => new Date('2026-09-24T12:00:00Z'),
      onPermissionDenied,
    }),
    { initialProps: { allowed: canAdjust }, wrapper: wrapper(queryClient) }
  )
  return { ...hook, queryClient, onPermissionDenied }
}
function mockReads() {
  vi.spyOn(billingApi, 'getAccountSnapshot').mockResolvedValue(ACCOUNT)
  vi.spyOn(adjustmentApi, 'getCreditAdjustmentFamily').mockResolvedValue(FAMILY)
  vi.spyOn(adjustmentApi, 'getCreditAdjustmentReversalOperation').mockResolvedValue({
    items: [], asOf: LOCAL_AT, nextCursor: null,
  })
}
async function openAndReason(result: ReturnType<typeof renderWorkflow>['result']) {
  await act(async () => { await result.current.open(ORIGINAL) })
  act(() => result.current.setReason('Compensate correction'))
}

afterEach(() => {
  vi.restoreAllMocks()
  creditAdjustmentReversalRecoveryStore.clearForTests()
})

describe('useCreditAdjustmentReversal', () => {
  it('opens only after parallel fresh reads and creates no UUID when confirm evidence changes', async () => {
    const account = vi.spyOn(billingApi, 'getAccountSnapshot')
      .mockResolvedValueOnce(ACCOUNT)
      .mockResolvedValueOnce({ ...ACCOUNT, walletVersion: '14' })
    vi.spyOn(adjustmentApi, 'getCreditAdjustmentFamily').mockResolvedValue(FAMILY)
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
    const uuid = vi.fn(() => OPERATION)
    const { result } = renderHook(() => useCreditAdjustmentReversal({
      clientId: CLIENT, actorUserId: ACTOR, canAdjust: true, canView: true, uuidFactory: uuid,
    }), { wrapper: wrapper(client()) })

    await openAndReason(result)
    expect(result.current.phase).toBe('review')
    await act(async () => { await result.current.confirm() })

    expect(account).toHaveBeenCalledTimes(2)
    expect(uuid).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('review')
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('single-flights confirm, freezes exact bytes and refreshes authoritative evidence', async () => {
    mockReads()
    let resolvePost!: (receipt: CreditAdjustmentReversalReceipt) => void
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal').mockImplementation(() =>
      new Promise((resolve) => { resolvePost = resolve }))
    const uuid = vi.fn(() => OPERATION)
    const queryClient = client()
    const { result } = renderHook(() => useCreditAdjustmentReversal({
      clientId: CLIENT, actorUserId: ACTOR, canAdjust: true, canView: true,
      uuidFactory: uuid,
    }), { wrapper: wrapper(queryClient) })
    await openAndReason(result)

    let confirmations!: Promise<unknown>
    act(() => {
      confirmations = Promise.all([result.current.confirm(), result.current.confirm()])
    })
    await waitFor(() => expect(
      queryClient.getMutationCache().getAll().map((mutation) => mutation.options.mutationKey))
      .toContainEqual(billingAdjustmentKeys.reversalCommand(CLIENT, ORIGINAL_ID)))
    await act(async () => {
      resolvePost(RECEIPT)
      await confirmations
    })

    expect(uuid).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0]?.[6]).toBe(
      `{"operationId":"${OPERATION}","expectedWalletVersion":13,"reason":"Compensate correction"}`)
    expect(result.current.phase).toBe('success')
    expect(result.current.receipt).toEqual(RECEIPT)
    expect(queryClient.getMutationCache().getAll()).toEqual([])
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it('retains an ambiguous outcome and retries only the identical UUID and bytes', async () => {
    mockReads()
    const post = vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'lost' })
      .mockResolvedValueOnce(RECEIPT)
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)
    await act(async () => { await workflow.result.current.confirm() })
    expect(workflow.result.current.phase).toBe('unknown')
    const retained = creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)
    expect(retained?.operationId).toBe(OPERATION)

    await act(async () => { await workflow.result.current.retry() })

    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[4]).toEqual(post.mock.calls[0]?.[4])
    expect(post.mock.calls[1]?.[6]).toBe(post.mock.calls[0]?.[6])
    expect(workflow.result.current.phase).toBe('success')
  })

  it('resolves landed ambiguity only from the exact operation evidence without a receipt merge', async () => {
    mockReads()
    vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValue({ code: 'credit_adjustment_reversal_outcome_unknown', status: 503, message: 'unknown' })
    vi.mocked(adjustmentApi.getCreditAdjustmentReversalOperation).mockResolvedValue({
      items: [REVERSAL], asOf: LOCAL_AT, nextCursor: null,
    })
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)

    await act(async () => { await workflow.result.current.confirm() })

    expect(workflow.result.current.phase).toBe('success')
    expect(workflow.result.current.receipt).toBeNull()
    expect(workflow.result.current.reconciled).toBe(true)
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it.each([
    [400, 'credit_adjustment_reversal_invalid_request', 'invalid_request'],
    [404, 'credit_adjustment_reversal_original_not_found', 'original_not_found'],
    [409, 'credit_adjustment_already_reversed', 'already_reversed'],
    [409, 'credit_adjustment_reversal_stale_wallet_version', 'stale_wallet_version'],
    [409, 'credit_adjustment_reversal_insufficient_available_credits', 'insufficient_available_credits'],
    [409, 'credit_balance_overflow', 'balance_overflow'],
    [409, 'credit_account_inactive', 'account_inactive'],
    [409, 'credit_account_version_exhausted', 'version_exhausted'],
    [409, 'credit_adjustment_reversal_invalid_original', 'invalid_original'],
    [409, 'credit_adjustment_reversal_operation_conflict', 'operation_conflict'],
    [409, 'time_zone_not_set', 'time_zone_not_set'],
    [413, 'request_body_too_large', 'contract_defect'],
    [415, 'unsupported_media_type', 'contract_defect'],
    [503, 'authorization_dependency_unavailable', 'dependency_unavailable'],
  ])('retires determinate %i/%s as %s', async (status, code, disposition) => {
    mockReads()
    vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValue({ status, code, message: 'safe' })
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)
    await act(async () => { await workflow.result.current.confirm() })
    expect(workflow.result.current.phase).toBe('rejected')
    expect(workflow.result.current.disposition).toBe(disposition)
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it('closes only the reversal workflow and reports a final command 403', async () => {
    mockReads()
    vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValue({ status: 403, code: 'HTTP_403', message: 'denied' })
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)
    await act(async () => { await workflow.result.current.confirm() })
    expect(workflow.result.current.phase).toBe('idle')
    expect(workflow.onPermissionDenied).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }))
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it('clears the sealed attempt and emits session recovery after a final command 401', async () => {
    mockReads()
    vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValue({ status: 401, code: 'HTTP_401', message: 'session ended' })
    const cleared = vi.fn()
    window.addEventListener('auth:cleared', cleared, { once: true })
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)
    await act(async () => { await workflow.result.current.confirm() })
    expect(workflow.result.current.phase).toBe('idle')
    expect(cleared).toHaveBeenCalledOnce()
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it('clears reversal-only state on adjust loss and all state on session loss', async () => {
    mockReads()
    const workflow = renderWorkflow()
    await openAndReason(workflow.result)
    workflow.rerender({ allowed: false })
    expect(workflow.result.current.phase).toBe('idle')
    expect(workflow.result.current.review).toBeNull()

    workflow.rerender({ allowed: true })
    await openAndReason(workflow.result)
    act(() => window.dispatchEvent(new CustomEvent('auth:cleared')))
    expect(workflow.result.current.phase).toBe('idle')
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)).toBeNull()
  })

  it('quarantines on final unmount and auto-reconciles a compatible remount', async () => {
    mockReads()
    vi.spyOn(adjustmentApi, 'postCreditAdjustmentReversal')
      .mockRejectedValue({ code: 'NETWORK_ERROR', message: 'lost' })
    const queryClient = client()
    const first = renderWorkflow(queryClient)
    await openAndReason(first.result)
    await act(async () => { await first.result.current.confirm() })
    first.unmount()
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)?.quarantined).toBe(true)

    vi.mocked(adjustmentApi.getCreditAdjustmentReversalOperation).mockResolvedValue({
      items: [REVERSAL], asOf: LOCAL_AT, nextCursor: null,
    })
    const restored = renderWorkflow(queryClient)
    await waitFor(() => expect(restored.result.current.phase).toBe('success'))
    expect(restored.result.current.reconciled).toBe(true)
  })
})
