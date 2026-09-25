import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiError } from './apiClient'
import { useAuthStore } from '../stores/authStore'
import type { CreditAdjustmentHistoryOriginalItem } from '../types/billing'
import {
  BillingAdjustmentContractError,
  calculateCreditAdjustmentReversalProjection,
  classifyCreditAdjustmentReversalError,
  getCreditAdjustmentFamily,
  getCreditAdjustmentReversalOperation,
  getCreditAdjustmentOperation,
  getCreditAdjustmentHistoryPage,
  parseCreditAdjustmentHistory,
  parseCreditAdjustmentHistoryPage,
  parseCreditAdjustmentPreview,
  parseCreditAdjustmentReceipt,
  parseCreditAdjustmentFamily,
  parseCreditAdjustmentReversalReceipt,
  parseCreditAdjustmentReversalReconciliation,
  postCreditAdjustment,
  postCreditAdjustmentReversal,
  previewCreditAdjustment,
  serializeCreditAdjustmentCommandRequest,
  serializeCreditAdjustmentReversalRequest,
  serializeCreditAdjustmentPreviewRequest,
} from './billingAdjustmentApi'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACCOUNT = '0199b9d2-a9b1-7000-8000-000000000002'
const ACTOR = '22222222-3333-4444-8555-666666666666'
const OPERATION = '0199b9d2-a9b1-7000-8000-000000000001'
const ADJUSTMENT = '0199b9d2-a9b1-7000-8000-000000000003'
const LEDGER = '0199b9d2-a9b1-7000-8000-000000000004'
const REVERSAL_OPERATION = '0199b9d2-a9b1-7000-8000-000000000005'
const REVERSAL = '0199b9d2-a9b1-7000-8000-000000000006'
const REVERSAL_LEDGER = '0199b9d2-a9b1-7000-8000-000000000007'
const AT = '2026-09-24T12:00:00.123456Z'
const LOCAL_AT = '2026-09-24T14:00:00.123456'
const REASON = 'Correct duplicate allocation'
const REVERSAL_REASON = 'Compensate correction'

const material = { amount: '-25.5000', reason: REASON }
const command = {
  operationId: OPERATION,
  expectedWalletVersion: '9223372036854775807',
  ...material,
}

function previewBody(overrides = ''): string {
  return `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","walletVersion":12,"asOf":"${AT}","amount":-25.5000,"currentOwnedBalance":100.0000,"currentReservedBalance":20.0000,"currentAvailableBalance":80.0000,"projectedOwnedBalance":74.5000,"projectedReservedBalance":20.0000,"projectedAvailableBalance":54.5000,"maximumSafeDebit":80.0000,"minimumAllowedAmount":-80.0000,"walletInvariantEligible":true,"ineligibilityCode":null${overrides}}`
}

function receiptBody(): string {
  return `{"schemaVersion":1,"operationId":"${OPERATION}","adjustmentId":"${ADJUSTMENT}","ledgerId":"${LEDGER}","clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","amount":-25.5000,"reason":"${REASON}","performedBy":"${ACTOR}","walletVersionBefore":12,"walletVersionAfter":13,"beforeOwnedBalance":100.0000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":80.0000,"afterOwnedBalance":74.5000,"afterReservedBalance":20.0000,"afterAvailableBalance":54.5000,"operationAsOf":"${AT}"}`
}

function historyBody(items = receiptBody()
  .replace('{"schemaVersion":1,', `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}",`)
  .replace(`"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}",`, '')
  .replace('"amount":', '"operationType":"original","amount":')
  .replace('"walletVersionBefore":12,', '"expectedWalletVersion":12,"walletVersionBefore":12,')
  .replace('"operationAsOf":', '"operationAsOf":')
  .replace(/}$/, ',"originalAdjustmentId":null,"reversalAdjustmentId":null}')): string {
  return `{"items":[${items.split(AT).join(LOCAL_AT)}],"asOf":"${LOCAL_AT}","nextCursor":null}`
}

function localOriginal(reversalId: string | null = REVERSAL): string {
  return `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","operationId":"${OPERATION}","adjustmentId":"${ADJUSTMENT}","ledgerId":"${LEDGER}","operationType":"original","amount":-25.5000,"reason":"${REASON}","performedBy":"${ACTOR}","expectedWalletVersion":12,"walletVersionBefore":12,"walletVersionAfter":13,"beforeOwnedBalance":100.0000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":80.0000,"afterOwnedBalance":74.5000,"afterReservedBalance":20.0000,"afterAvailableBalance":54.5000,"operationAsOf":"${LOCAL_AT}","originalAdjustmentId":null,"reversalAdjustmentId":${reversalId === null ? 'null' : `"${reversalId}"`}}`
}

function localReversal(): string {
  return `{"schemaVersion":1,"clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","operationId":"${REVERSAL_OPERATION}","adjustmentId":"${REVERSAL}","ledgerId":"${REVERSAL_LEDGER}","operationType":"reversal","amount":25.5000,"reason":"Compensate correction","performedBy":"${ACTOR}","expectedWalletVersion":13,"walletVersionBefore":13,"walletVersionAfter":14,"beforeOwnedBalance":74.5000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":54.5000,"afterOwnedBalance":100.0000,"afterReservedBalance":20.0000,"afterAvailableBalance":80.0000,"operationAsOf":"2026-09-24T15:00:00.123456","originalAdjustmentId":"${ADJUSTMENT}","reversalAdjustmentId":null}`
}

function localHistoryBody(items = `${localReversal()},${localOriginal()}`,
  cursor: string | null = 'opaque+/='): string {
  return `{"items":[${items}],"asOf":"2026-09-24T16:00:00.123456","nextCursor":${cursor === null ? 'null' : `"${cursor}"`}}`
}

function reversalReceiptBody(overrides = ''): string {
  return `{"schemaVersion":1,"operationId":"${REVERSAL_OPERATION}","originalAdjustmentId":"${ADJUSTMENT}","reversalAdjustmentId":"${REVERSAL}","reversalLedgerId":"${REVERSAL_LEDGER}","clientId":"${CLIENT}","creditAccountId":"${ACCOUNT}","compensatingAmount":25.5000,"reason":"${REVERSAL_REASON}","performedBy":"${ACTOR}","walletVersionBefore":13,"walletVersionAfter":14,"beforeOwnedBalance":74.5000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":54.5000,"afterOwnedBalance":100.0000,"afterReservedBalance":20.0000,"afterAvailableBalance":80.0000,"operationAsOf":"${LOCAL_AT}"${overrides}}`
}

function currentAccount() {
  return {
    creditAccountId: ACCOUNT, clientId: CLIENT, ownedBalance: '74.5000',
    activelyReservedAmount: '20.0000', availableBalance: '54.5000',
    activeReservationCount: 1, status: 'active' as const,
    asOf: LOCAL_AT, walletVersion: '13',
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: {
    id: ACTOR, clientId: CLIENT, email: 'actor@example.test', displayName: 'Actor', role: 'Admin',
    accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600,
  } })
})

describe('credit adjustment strict adapter', () => {
  it('serializes closed preview and command bodies with exact unquoted numeric tokens', () => {
    expect(serializeCreditAdjustmentPreviewRequest(material)).toBe(
      `{"amount":-25.5000,"reason":"${REASON}"}`)
    expect(serializeCreditAdjustmentCommandRequest(command)).toBe(
      `{"operationId":"${OPERATION}","expectedWalletVersion":9223372036854775807,"amount":-25.5000,"reason":"${REASON}"}`)
    expect(serializeCreditAdjustmentPreviewRequest({
      amount: '99999999999999.9999', reason: 'Maximum',
    })).toContain('99999999999999.9999')
    expect(serializeCreditAdjustmentPreviewRequest({
      amount: '-99999999999999.9999', reason: '😀'.repeat(512),
    })).toContain('"reason":"😀')
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '0', reason: REASON }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '1e2', reason: REASON }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '01', reason: REASON }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '1', reason: '😀'.repeat(513) }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '1', reason: 'line\nbreak' }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentPreviewRequest({ amount: '1', reason: '\uD800' }))
      .toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentCommandRequest({ ...command,
      expectedWalletVersion: '9223372036854775808' })).toThrow(BillingAdjustmentContractError)
  })

  it('parses preview losslessly and rejects closed-shape, duplicate, identity and equation defects', () => {
    const preview = parseCreditAdjustmentPreview(previewBody(), CLIENT, ACCOUNT, material)
    expect(preview.amount).toBe('-25.5000')
    expect(preview.walletVersion).toBe('12')
    expect(preview.projectedAvailableBalance).toBe('54.5000')
    expect(() => parseCreditAdjustmentPreview(previewBody(',"extra":true'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentPreview(previewBody().replace(
      '"amount":-25.5000', '"amount":-25.5000,"amount":-25.5000'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentPreview(previewBody().replace(
      '"projectedAvailableBalance":54.5000', '"projectedAvailableBalance":54.5001'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentPreview(previewBody().replace(CLIENT,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentPreview(previewBody().replace(ACCOUNT,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentPreview(previewBody().replace(AT,
      '2026-02-30T12:00:00Z'), CLIENT, ACCOUNT, material))
      .toThrow(BillingAdjustmentContractError)
  })

  it('validates complete receipt and exact original history evidence', () => {
    const request = { ...command, expectedWalletVersion: '12' }
    const receipt = parseCreditAdjustmentReceipt(receiptBody(), CLIENT, ACCOUNT, ACTOR, request)
    expect(receipt.walletVersionAfter).toBe('13')
    const history = parseCreditAdjustmentHistory(historyBody(), CLIENT, ACTOR, request, ACCOUNT)
    expect(history.items).toHaveLength(1)
    expect(history.items[0]?.operationId).toBe(OPERATION)
    expect(() => parseCreditAdjustmentReceipt(receiptBody().replace(
      '"walletVersionAfter":13', '"walletVersionAfter":14'), CLIENT, ACCOUNT, ACTOR, request))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentReceipt(receiptBody().replace(ACCOUNT,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), CLIENT, ACCOUNT, ACTOR, request))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistory(historyBody().replace(
      `"performedBy":"${ACTOR}"`, '"performedBy":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"'),
    CLIENT, ACTOR, request, ACCOUNT)).toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistory(historyBody().replace(
      '"nextCursor":null', '"nextCursor":"more"'), CLIENT, ACTOR, request, ACCOUNT))
      .toThrow(BillingAdjustmentContractError)
  })

  it('parses a general local history page losslessly with both relationship directions', () => {
    const page = parseCreditAdjustmentHistoryPage(localHistoryBody(), CLIENT)
    expect(page.nextCursor).toBe('opaque+/=')
    expect(page.asOf).toBe('2026-09-24T16:00:00.123456')
    expect(page.items.map((item) => item.operationType)).toEqual(['reversal', 'original'])
    expect(page.items[0]).toMatchObject({ originalAdjustmentId: ADJUSTMENT,
      reversalAdjustmentId: null, amount: '25.5000', walletVersionAfter: '14' })
    expect(page.items[1]).toMatchObject({ originalAdjustmentId: null,
      reversalAdjustmentId: REVERSAL, amount: '-25.5000', beforeOwnedBalance: '100.0000' })
  })

  it('rejects malformed local pages, UUID kinds, cursor defects and impossible relationships', () => {
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(LOCAL_AT, AT), CLIENT)).toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(`"adjustmentId":"${ADJUSTMENT}"`,
        `"adjustmentId":"${ADJUSTMENT.toUpperCase()}"`), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"nextCursor":"opaque+/="', '"nextCursor":""'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"amount":25.5000', '"amount":-25.5000'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(`"originalAdjustmentId":"${ADJUSTMENT}"`,
        `"originalAdjustmentId":"${REVERSAL}"`), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"schemaVersion":1,', '"schemaVersion":1,"extra":true,'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"amount":25.5000', '"amount":25.5000,"amount":25.5000'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"amount":25.5000', '"amount":"25.5000"'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace('"amount":25.5000', '"amount":0.0000'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(`"clientId":"${CLIENT}"`,
        '"clientId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"'), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(`"reversalAdjustmentId":"${REVERSAL}"`,
        `"reversalAdjustmentId":"${ADJUSTMENT}"`), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      localHistoryBody().replace(`,"reason":"${REASON}"`, ''), CLIENT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage(
      `{"items":[${Array(101).fill(localOriginal(null)).join(',')}],"asOf":"${LOCAL_AT}","nextCursor":null}`,
      CLIENT)).toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistoryPage('{', CLIENT))
      .toThrow(BillingAdjustmentContractError)
  })

  it('accepts zero balances and the maximum valid signed-BIGINT successor without IEEE conversion', () => {
    const item = localOriginal(null)
      .replace('"amount":-25.5000', '"amount":1.0000')
      .replace('"expectedWalletVersion":12,"walletVersionBefore":12,"walletVersionAfter":13',
        '"expectedWalletVersion":9223372036854775806,"walletVersionBefore":9223372036854775806,"walletVersionAfter":9223372036854775807')
      .replace('"beforeOwnedBalance":100.0000,"beforeReservedBalance":20.0000,"beforeAvailableBalance":80.0000,"afterOwnedBalance":74.5000,"afterReservedBalance":20.0000,"afterAvailableBalance":54.5000',
        '"beforeOwnedBalance":0.0000,"beforeReservedBalance":0.0000,"beforeAvailableBalance":0.0000,"afterOwnedBalance":1.0000,"afterReservedBalance":0.0000,"afterAvailableBalance":1.0000')
    const page = parseCreditAdjustmentHistoryPage(localHistoryBody(item, null), CLIENT)
    expect(page.items[0]?.walletVersionAfter).toBe('9223372036854775807')
    expect(page.items[0]?.beforeOwnedBalance).toBe('0.0000')
    expect(() => parseCreditAdjustmentHistoryPage(localHistoryBody(item.replace(
      '"expectedWalletVersion":9223372036854775806,"walletVersionBefore":9223372036854775806',
      '"expectedWalletVersion":9223372036854775807,"walletVersionBefore":9223372036854775807'), null), CLIENT))
      .toThrow(BillingAdjustmentContractError)
  })

  it('builds initial filters and continuation with URLSearchParams on the local endpoint', async () => {
    const get = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: localHistoryBody('', null), status: 200,
      headers: { 'content-type': 'application/json' } as never,
    })
    await getCreditAdjustmentHistoryPage(CLIENT, { filters: {
      from: '2026-09-24T00:00:00.000000', reason: 'A & B', operationType: 'original',
      pageSize: '20',
    } })
    await getCreditAdjustmentHistoryPage(CLIENT, { cursor: 'opaque+/=' })
    expect(get).toHaveBeenNthCalledWith(1,
      `/api/backoffice/clients/${CLIENT}/billing/adjustments?from=2026-09-24T00%3A00%3A00.000000&reason=A+%26+B&operationType=original&pageSize=20`,
      expect.objectContaining({ responseType: 'text' }))
    expect(get).toHaveBeenNthCalledWith(2,
      `/api/backoffice/clients/${CLIENT}/billing/adjustments?cursor=opaque%2B%2F%3D`,
      expect.objectContaining({ responseType: 'text' }))
  })

  it('keeps operation reconciliation stricter than the shared local parser', () => {
    const request = { ...command, expectedWalletVersion: '12' }
    expect(() => parseCreditAdjustmentHistory(
      localHistoryBody(localReversal(), null), CLIENT, ACTOR, request, ACCOUNT))
      .toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistory(
      localHistoryBody(`${localOriginal(null)},${localOriginal(null)}`, null),
      CLIENT, ACTOR, request, ACCOUNT)).toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentHistory(
      localHistoryBody(localOriginal(null), 'more'), CLIENT, ACTOR, request, ACCOUNT))
      .toThrow(BillingAdjustmentContractError)
  })

  it.each([
    [400, 'credit_adjustment_history_invalid_query'], [401, 'HTTP_401'], [403, 'HTTP_403'],
    [409, 'time_zone_not_set'], [422, 'local_time_ambiguous'],
    [500, 'credit_adjustment_history_integrity_failure'],
    [503, 'credit_adjustment_history_dependency_unavailable'],
  ])('preserves history HTTP %i failures without fallback or partial parsing', async (status, code) => {
    const error = { status, code, message: 'safe' } satisfies ApiError
    const get = vi.spyOn(apiClient, 'getApiRoot').mockRejectedValue(error)
    await expect(getCreditAdjustmentHistoryPage(CLIENT, { filters: {} })).rejects.toBe(error)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('uses only the API-origin routes, exact retained bytes, JSON media type and AbortSignal', async () => {
    const signal = new AbortController().signal
    const post = vi.spyOn(apiClient, 'postApiRoot')
      .mockResolvedValueOnce({ data: previewBody(), status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' } as never })
      .mockResolvedValueOnce({ data: receiptBody(), status: 200,
        headers: { 'content-type': 'application/json' } as never })
    const get = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: historyBody(), status: 200,
      headers: { 'content-type': 'application/json' } as never,
    })
    const onPreviewReplay = vi.fn()
    await previewCreditAdjustment(CLIENT.toUpperCase(), ACCOUNT, material, signal, onPreviewReplay)
    const request = { ...command, expectedWalletVersion: '12' }
    const bytes = serializeCreditAdjustmentCommandRequest(request)
    await postCreditAdjustment(CLIENT, ACCOUNT, request, signal, bytes)
    await getCreditAdjustmentOperation(CLIENT, OPERATION, ACTOR, request, ACCOUNT, signal)
    expect(post).toHaveBeenNthCalledWith(1,
      `/api/billing/clients/${CLIENT}/credit-adjustments/preview`,
      serializeCreditAdjustmentPreviewRequest(material), expect.objectContaining({ signal,
        responseType: 'text', headers: { 'Content-Type': 'application/json' },
        onAuthReplay: onPreviewReplay }))
    expect(post).toHaveBeenNthCalledWith(2,
      `/api/billing/clients/${CLIENT}/credit-adjustments`, bytes,
      expect.objectContaining({ signal, responseType: 'text' }))
    expect(get).toHaveBeenCalledWith(
      `/api/backoffice/clients/${CLIENT}/billing/adjustments?operationId=${OPERATION}&pageSize=1`,
      expect.objectContaining({ signal, responseType: 'text' }))
    await expect(postCreditAdjustment(CLIENT, ACCOUNT, request, signal, `${bytes} `))
      .rejects.toBeInstanceOf(BillingAdjustmentContractError)
  })

  it.each([
    [400, 'credit_adjustment_invalid_request'], [401, 'HTTP_401'], [403, 'HTTP_403'],
    [404, 'HTTP_404'], [409, 'credit_adjustment_stale_wallet_version'],
    [413, 'request_body_too_large'], [415, 'unsupported_media_type'],
    [500, 'HTTP_500'], [503, 'credit_adjustment_outcome_unknown'],
  ])('preserves stable HTTP %i failures without fallback probing', async (status, code) => {
    const error = { status, code, message: 'safe' } satisfies ApiError
    vi.spyOn(apiClient, 'postApiRoot').mockRejectedValue(error)
    await expect(postCreditAdjustment(CLIENT, ACCOUNT, { ...command, expectedWalletVersion: '12' }))
      .rejects.toBe(error)
  })

  it('rejects a non-JSON success response before exposing evidence', async () => {
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: previewBody(), status: 200, headers: { 'content-type': 'text/html' } as never,
    })
    await expect(previewCreditAdjustment(CLIENT, ACCOUNT, material))
      .rejects.toBeInstanceOf(BillingAdjustmentContractError)
  })
})

describe('credit adjustment reversal strict adapter', () => {
  const reversalRequest = {
    operationId: REVERSAL_OPERATION,
    expectedWalletVersion: '13',
    reason: REVERSAL_REASON,
  }
  const original = (): CreditAdjustmentHistoryOriginalItem => {
    const item = parseCreditAdjustmentHistoryPage(
      localHistoryBody(localOriginal(null), null), CLIENT
    ).items[0]!
    if (item.operationType !== 'original') throw new Error('fixture is not an original')
    return item
  }

  it('serializes exactly three fields with an unquoted lossless BIGINT', () => {
    expect(serializeCreditAdjustmentReversalRequest(reversalRequest)).toBe(
      `{"operationId":"${REVERSAL_OPERATION}","expectedWalletVersion":13,"reason":"${REVERSAL_REASON}"}`)
    expect(serializeCreditAdjustmentReversalRequest({
      ...reversalRequest, expectedWalletVersion: '9223372036854775807',
    })).toContain('"expectedWalletVersion":9223372036854775807')
    expect(() => serializeCreditAdjustmentReversalRequest({
      ...reversalRequest, expectedWalletVersion: '9223372036854775808',
    })).toThrow(BillingAdjustmentContractError)
    expect(() => serializeCreditAdjustmentReversalRequest({
      ...reversalRequest, reason: ' line\nbreak ',
    })).toThrow(BillingAdjustmentContractError)
  })

  it('validates all nineteen receipt fields, local time, inverse, identity and equations', () => {
    const receipt = parseCreditAdjustmentReversalReceipt(
      reversalReceiptBody(), CLIENT, currentAccount(), ACTOR, original(), reversalRequest)
    expect(receipt.compensatingAmount).toBe('25.5000')
    expect(receipt.operationAsOf).toBe(LOCAL_AT)
    for (const defect of [
      [LOCAL_AT, AT],
      ['"compensatingAmount":25.5000', '"compensatingAmount":25.5001'],
      ['"walletVersionAfter":14', '"walletVersionAfter":15'],
      [`"originalAdjustmentId":"${ADJUSTMENT}"`, `"originalAdjustmentId":"${REVERSAL}"`],
      ['"operationAsOf"', '"unknown"'],
      ['"walletVersionBefore":13', '"walletVersionBefore":9007199254740992.0'],
    ] as const) {
      expect(() => parseCreditAdjustmentReversalReceipt(
        reversalReceiptBody().replace(defect[0], defect[1]),
        CLIENT, currentAccount(), ACTOR, original(), reversalRequest
      )).toThrow(BillingAdjustmentContractError)
    }
  })

  it('closes selected families to one unlinked original or two reciprocal rows', () => {
    const open = parseCreditAdjustmentFamily(
      localHistoryBody(localOriginal(null), null), CLIENT, ADJUSTMENT)
    expect(open).toMatchObject({ original: { adjustmentId: ADJUSTMENT }, reversal: null })
    const linked = parseCreditAdjustmentFamily(
      localHistoryBody(`${localReversal()},${localOriginal()}`, null), CLIENT, ADJUSTMENT)
    expect(linked.reversal?.adjustmentId).toBe(REVERSAL)
    expect(() => parseCreditAdjustmentFamily(
      localHistoryBody(localReversal(), null), CLIENT, ADJUSTMENT
    )).toThrow(BillingAdjustmentContractError)
    expect(() => parseCreditAdjustmentFamily(
      localHistoryBody(localOriginal(null), 'more'), CLIENT, ADJUSTMENT
    )).toThrow(BillingAdjustmentContractError)
  })

  it('projects debit equality and credit extremes with scaled bigint only', () => {
    const debitOriginal = { ...original(), amount: '25.5000',
      beforeOwnedBalance: '49.0000', beforeReservedBalance: '20.0000',
      beforeAvailableBalance: '29.0000', afterOwnedBalance: '74.5000',
      afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000' }
    const equality = calculateCreditAdjustmentReversalProjection({
      creditAccountId: ACCOUNT, clientId: CLIENT, ownedBalance: '45.5000',
      activelyReservedAmount: '20.0000', availableBalance: '25.5000',
      activeReservationCount: 1, status: 'active', asOf: LOCAL_AT, walletVersion: '13',
    }, debitOriginal)
    expect(equality).toMatchObject({ advisoryEligible: true,
      inverseAmount: '-25.5000', projectedAvailableBalance: '0.0000' })
    const overflow = calculateCreditAdjustmentReversalProjection({
      creditAccountId: ACCOUNT, clientId: CLIENT, ownedBalance: '99999999999999.9999',
      activelyReservedAmount: '0.0000', availableBalance: '99999999999999.9999',
      activeReservationCount: 0, status: 'active', asOf: LOCAL_AT,
      walletVersion: '9223372036854775806',
    }, original())
    expect(overflow).toMatchObject({ advisoryEligible: false,
      ineligibilityCode: 'credit_balance_overflow' })
  })

  it('uses exact local command, family and operation routes with retained bytes and signals', async () => {
    const signal = new AbortController().signal
    const bytes = serializeCreditAdjustmentReversalRequest(reversalRequest)
    const post = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: reversalReceiptBody(), status: 200,
      headers: { 'content-type': 'application/json' } as never,
    })
    const get = vi.spyOn(apiClient, 'getApiRoot')
      .mockResolvedValueOnce({ data: localHistoryBody(localOriginal(null), null), status: 200,
        headers: { 'content-type': 'application/json' } as never })
      .mockResolvedValueOnce({ data: localHistoryBody(localReversal(), null), status: 200,
        headers: { 'content-type': 'application/json' } as never })
    await getCreditAdjustmentFamily(CLIENT, ADJUSTMENT, signal)
    await postCreditAdjustmentReversal(
      CLIENT, ADJUSTMENT, currentAccount(), original(), reversalRequest, signal, bytes)
    await getCreditAdjustmentReversalOperation(
      CLIENT, ADJUSTMENT, currentAccount(), ACTOR, original(), reversalRequest, signal)
    expect(get).toHaveBeenNthCalledWith(1,
      `/api/backoffice/clients/${CLIENT}/billing/adjustments?originalAdjustmentId=${ADJUSTMENT}&pageSize=2`,
      expect.objectContaining({ signal, responseType: 'text' }))
    expect(post).toHaveBeenCalledWith(
      `/api/backoffice/clients/${CLIENT}/billing/adjustments/${ADJUSTMENT}/reversal`, bytes,
      expect.objectContaining({ signal, responseType: 'text' }))
    expect(get).toHaveBeenNthCalledWith(2,
      `/api/backoffice/clients/${CLIENT}/billing/adjustments?operationId=${REVERSAL_OPERATION}&pageSize=1`,
      expect.objectContaining({ signal, responseType: 'text' }))
    await expect(postCreditAdjustmentReversal(
      CLIENT, ADJUSTMENT, currentAccount(), original(), reversalRequest, signal, `${bytes} `
    )).rejects.toBeInstanceOf(BillingAdjustmentContractError)
  })

  it('reconciles only the exact reciprocal reversal', () => {
    const landed = parseCreditAdjustmentReversalReconciliation(
      localHistoryBody(localReversal(), null), CLIENT, ADJUSTMENT, currentAccount(),
      ACTOR, original(), reversalRequest)
    expect(landed.items[0]?.adjustmentId).toBe(REVERSAL)
    expect(parseCreditAdjustmentReversalReconciliation(
      localHistoryBody('', null), CLIENT, ADJUSTMENT, currentAccount(),
      ACTOR, original(), reversalRequest).items).toEqual([])
    expect(() => parseCreditAdjustmentReversalReconciliation(
      localHistoryBody(localReversal().replace(REVERSAL_REASON, 'Another operation'), null),
      CLIENT, ADJUSTMENT, currentAccount(), ACTOR, original(), reversalRequest
    )).toThrow(BillingAdjustmentContractError)
  })

  it.each([
    [400, 'credit_adjustment_reversal_invalid_request', 'invalid_request'],
    [401, 'HTTP_401', 'session_lost'],
    [403, 'HTTP_403', 'permission_lost'],
    [404, 'credit_adjustment_reversal_original_not_found', 'original_not_found'],
    [409, 'credit_adjustment_already_reversed', 'already_reversed'],
    [409, 'credit_adjustment_reversal_stale_wallet_version', 'stale_wallet_version'],
    [409, 'time_zone_not_set', 'time_zone_not_set'],
    [503, 'authorization_dependency_unavailable', 'dependency_unavailable'],
    [503, 'credit_adjustment_reversal_outcome_unknown', 'ambiguous'],
    [500, 'HTTP_500', 'ambiguous'],
    [418, 'unknown', 'ambiguous'],
  ])('classifies closed response %i/%s as %s', (status, code, expected) => {
    expect(classifyCreditAdjustmentReversalError({ status, code, message: 'safe' }))
      .toBe(expected)
  })
})
