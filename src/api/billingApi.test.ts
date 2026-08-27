import { describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import {
  getBillingAccountSnapshot,
  getBillingLedgerExportStatus,
  getBillingLedgerPage,
  parseBillingAccountSnapshot,
  parseBillingLedgerExportAccepted,
  parseBillingLedgerExportStatus,
  parseBillingLedgerPage,
  redeemBillingLedgerExport,
  requestBillingLedgerExport,
} from './billingApi'
import type { BillingLedgerExportAttempt, BillingLedgerExportFilters } from '../types/billing'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'

function snapshotJson(overrides: Record<string, string | number> = {}) {
  return JSON.stringify({
    creditAccountId: ACCOUNT_ID,
    clientId: CLIENT_ID,
    ownedBalance: '__OWNED__',
    activelyReservedAmount: '__RESERVED__',
    availableBalance: '__AVAILABLE__',
    activeReservationCount: 0,
    status: 'active',
    asOf: '2026-08-24T07:00:00+00:00',
    ...overrides,
  })
    .replace('"__OWNED__"', '99999999999999.9999')
    .replace('"__RESERVED__"', '0.0001')
    .replace('"__AVAILABLE__"', '99999999999999.9998')
}

describe('parseBillingAccountSnapshot', () => {
  it('preserves high-magnitude decimal lexemes exactly as strings', () => {
    const result = parseBillingAccountSnapshot(snapshotJson(), CLIENT_ID)

    expect(result.ownedBalance).toBe('99999999999999.9999')
    expect(result.activelyReservedAmount).toBe('0.0001')
    expect(result.availableBalance).toBe('99999999999999.9998')
    expect(result.activeReservationCount).toBe(0)
    expect(result.asOf).toBe('2026-08-24T07:00:00+00:00')
  })

  it('preserves zero decimal scale', () => {
    const result = parseBillingAccountSnapshot(
      snapshotJson({
        ownedBalance: '__ZERO__',
        activelyReservedAmount: '__ZERO__',
        availableBalance: '__ZERO__',
      }).replace(/"__ZERO__"/g, '0.0000'),
      CLIENT_ID
    )

    expect(result.ownedBalance).toBe('0.0000')
    expect(result.activelyReservedAmount).toBe('0.0000')
    expect(result.availableBalance).toBe('0.0000')
  })

  it('fails closed when the response belongs to another Client', () => {
    expect(() =>
      parseBillingAccountSnapshot(
        snapshotJson({ clientId: 'ffffffff-1111-2222-3333-444444444444' }),
        CLIENT_ID
      )
    ).toThrow('response Client does not match the requested Client')
  })

  it.each([
    snapshotJson({ status: 'deleted' }),
    snapshotJson({ activeReservationCount: -1 }),
    snapshotJson({ asOf: 'not-a-date' }),
    snapshotJson({ asOf: '2026-08-24T09:00:00+02:00' }),
    snapshotJson({ extra: 'not-allowed' }),
  ])('rejects malformed or non-contract payloads', (payload) => {
    expect(() => parseBillingAccountSnapshot(payload, CLIENT_ID)).toThrow()
  })

  it('normalizes invalid JSON into a safe contract error', () => {
    expect(() => parseBillingAccountSnapshot('{invalid', CLIENT_ID)).toThrow(
      'Invalid Billing snapshot: response is not valid JSON'
    )
  })
})

describe('getBillingAccountSnapshot', () => {
  it('uses the canonical API-root route and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: snapshotJson(),
      status: 200,
    })

    await getBillingAccountSnapshot(CLIENT_ID, signal)

    expect(getApiRoot).toHaveBeenCalledWith(
      `/api/billing/clients/${CLIENT_ID}/account`,
      expect.objectContaining({ responseType: 'text', signal })
    )
  })
})

const LEDGER_ID = '77777777-7777-7777-7777-777777777777'
const OPERATION_ID = '88888888-8888-8888-8888-888888888888'

function ledgerJson(overrides: Record<string, unknown> = {}, pageOverrides: Record<string, unknown> = {}) {
  const item = {
    ledgerId: LEDGER_ID,
    creditAccountId: ACCOUNT_ID,
    jobId: null,
    reservationId: null,
    adjustmentId: null,
    operationId: OPERATION_ID,
    transactionType: 'subscription_grant',
    amount: '__AMOUNT__',
    balanceAfter: '__BALANCE__',
    ruleId: null,
    ruleVersion: null,
    actorUserId: null,
    reason: null,
    createdAt: '2026-08-24T07:00:00+00:00',
    ...overrides,
  }
  return JSON.stringify({
    items: [item],
    asOf: '2026-08-24T08:00:00+00:00',
    nextCursor: 'opaque-private-token',
    ...pageOverrides,
  })
    .replace('"__AMOUNT__"', '99999999999999.9999')
    .replace('"__BALANCE__"', '99999999999999.9999')
}

describe('parseBillingLedgerPage', () => {
  it('preserves exact decimal number lexemes and nullable fields', () => {
    const result = parseBillingLedgerPage(ledgerJson())

    expect(result.items[0]?.amount).toBe('99999999999999.9999')
    expect(result.items[0]?.balanceAfter).toBe('99999999999999.9999')
    expect(result.items[0]?.actorUserId).toBeNull()
    expect(result.nextCursor).toBe('opaque-private-token')
  })

  it.each([
    ['subscription_grant', '1.0000'],
    ['reservation', '-1.0000'],
    ['consumption', '-1.0000'],
    ['promotion', '1.0000'],
    ['reservation_expired', '1.0000'],
    ['reservation_committed', '1.0000'],
    ['reservation_released', '1.0000'],
    ['manual_adjustment', '1.0000'],
    ['manual_adjustment', '-1.0000'],
    ['reversal', '1.0000'],
    ['reversal', '-1.0000'],
  ])('accepts the required %s sign', (transactionType, amount) => {
    const payload = ledgerJson({ transactionType, amount: '__SIGNED__' })
      .replace('"__SIGNED__"', amount)
    expect(parseBillingLedgerPage(payload).items[0]?.amount).toBe(amount)
  })

  it.each(['0', '0.0000', '-0.0000'])('rejects lexical zero amount %s', (amount) => {
    const payload = ledgerJson({ amount: '__ZERO__' }).replace('"__ZERO__"', amount)
    expect(() => parseBillingLedgerPage(payload)).toThrow('Invalid Billing ledger')
  })

  it.each([
    ['subscription_grant', '-1.0000'],
    ['reservation', '1.0000'],
    ['consumption', '1.0000'],
    ['promotion', '-1.0000'],
    ['reservation_expired', '-1.0000'],
    ['reservation_committed', '-1.0000'],
    ['reservation_released', '-1.0000'],
  ])('rejects the wrong %s sign', (transactionType, amount) => {
    const payload = ledgerJson({ transactionType, amount: '__SIGNED__' })
      .replace('"__SIGNED__"', amount)
    expect(() => parseBillingLedgerPage(payload)).toThrow('amount sign')
  })

  it.each(['manual_adjustment', 'reversal'])('rejects zero as the invalid %s sign case', (transactionType) => {
    const payload = ledgerJson({ transactionType, amount: '__ZERO__' })
      .replace('"__ZERO__"', '0.0000')
    expect(() => parseBillingLedgerPage(payload)).toThrow('amount must be nonzero')
  })

  it('accepts zero balanceAfter and a maximum-range negative adjustment without coercion', () => {
    const payload = ledgerJson({
      transactionType: 'manual_adjustment', amount: '__SIGNED__', balanceAfter: '__ZERO__',
    })
      .replace('"__SIGNED__"', '-99999999999999.9999')
      .replace('"__ZERO__"', '0.0000')

    const result = parseBillingLedgerPage(payload)
    expect(result.items[0]?.amount).toBe('-99999999999999.9999')
    expect(result.items[0]?.balanceAfter).toBe('0.0000')
  })

  it.each([
    ledgerJson({}, { extra: 'nope' }),
    ledgerJson({ jobId: undefined }),
    ledgerJson({ reason: 12 }),
    ledgerJson({ createdAt: '2026-08-24T09:00:00+02:00' }),
    ledgerJson({}, { asOf: '2026-08-24T10:00:00+02:00' }),
    ledgerJson({}, { nextCursor: '' }),
  ])('rejects closed-shape, nullable, UTC, and cursor contract violations', (payload) => {
    expect(() => parseBillingLedgerPage(payload)).toThrow('Invalid Billing ledger')
  })

  it('rejects duplicate, post-watermark, and out-of-order rows within a page', () => {
    const base = JSON.parse(ledgerJson({ amount: 1, balanceAfter: 1 })) as {
      items: Array<Record<string, unknown>>
      asOf: string
      nextCursor: string | null
    }
    const item = base.items[0]!
    expect(() => parseBillingLedgerPage(JSON.stringify({
      ...base, items: [item, { ...item }],
    }))).toThrow('duplicate ledger row')
    expect(() => parseBillingLedgerPage(JSON.stringify({
      ...base, items: [{ ...item, createdAt: '2026-08-24T09:00:00+00:00' }],
    }))).toThrow('after the page watermark')
    expect(() => parseBillingLedgerPage(JSON.stringify({
      ...base,
      items: [
        { ...item, createdAt: '2026-08-24T06:00:00+00:00' },
        {
          ...item,
          ledgerId: '77777777-7777-7777-7777-777777777776',
          createdAt: '2026-08-24T07:00:00+00:00',
        },
      ],
    }))).toThrow('server order')
  })

  it('rejects wrong signs, negative balance, extra fields, and filtered-account mismatch', () => {
    expect(() => parseBillingLedgerPage(
      ledgerJson({ transactionType: 'reservation', amount: '__SIGNED__' }).replace('"__SIGNED__"', '1.0000')
    )).toThrow()
    expect(() => parseBillingLedgerPage(
      ledgerJson({ balanceAfter: '__NEGATIVE__' }).replace('"__NEGATIVE__"', '-1.0000')
    )).toThrow()
    expect(() => parseBillingLedgerPage(ledgerJson({ extra: 'nope' }))).toThrow()
    expect(() => parseBillingLedgerPage(
      ledgerJson({ creditAccountId: 'ffffffff-1111-2222-3333-444444444444' }),
      ACCOUNT_ID
    )).toThrow('filtered Credit account')
  })
})

describe('getBillingLedgerPage', () => {
  it('serializes only normalized initial filters and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: ledgerJson(), status: 200,
    })

    await getBillingLedgerPage(CLIENT_ID, {
      filters: {
        creditAccountId: ACCOUNT_ID,
        transactionType: 'subscription_grant',
        pageSize: 20,
      },
    }, signal)

    const [url, config] = getApiRoot.mock.calls[0] ?? []
    expect(url).toBe(`/api/billing/clients/${CLIENT_ID}/ledger?creditAccountId=${ACCOUNT_ID}&transactionType=subscription_grant&pageSize=20`)
    expect(config).toEqual(expect.objectContaining({ responseType: 'text', signal }))
  })

  it('sends a continuation as exactly one opaque cursor parameter', async () => {
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({
      data: ledgerJson(), status: 200,
    })

    await getBillingLedgerPage(CLIENT_ID, { cursor: 'opaque +/ token' })

    expect(getApiRoot.mock.calls[0]?.[0]).toBe(
      `/api/billing/clients/${CLIENT_ID}/ledger?cursor=opaque+%2B%2F+token`
    )
  })
})

const EXPORT_ID = '0198d2b0-1234-7abc-8abc-1234567890ab'
const EXPORT_FILTERS: BillingLedgerExportFilters = {
  creditAccountId: ACCOUNT_ID,
  from: '2026-08-24T06:00:00+00:00',
  to: '2026-08-24T09:00:00+00:00',
  transactionType: 'promotion',
  actorUserId: null,
  jobId: null,
  reservationId: null,
}
const EXPORT_ATTEMPT: BillingLedgerExportAttempt = {
  exportId: EXPORT_ID,
  clientId: CLIENT_ID,
  filters: EXPORT_FILTERS,
  requestedAt: '2026-08-24T10:00:00+00:00',
  asOf: '2026-08-24T10:00:00+00:00',
}

function acceptedJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...EXPORT_ATTEMPT, status: 'pending', ...overrides })
}

function statusJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...EXPORT_ATTEMPT,
    status: 'completed',
    rowCount: '__ROWS__',
    byteSize: '__BYTES__',
    artifactExpiresAt: '2099-08-24T11:00:00+00:00',
    failureCode: null,
    reference: 'opaque-bearer-reference',
    referenceExpiresAt: '2099-08-24T10:05:00+00:00',
    ...overrides,
  }).replace('"__ROWS__"', '9007199254740993').replace('"__BYTES__"', '9223372036854775807')
}

describe('Billing ledger export adapter', () => {
  it('posts the exact API-root body, omits page size, uses empty filters, and forwards cancellation', async () => {
    const postApiRoot = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: acceptedJson(), status: 202,
    })
    const signal = new AbortController().signal

    await requestBillingLedgerExport(CLIENT_ID.toUpperCase(), {
      creditAccountId: ACCOUNT_ID,
      from: EXPORT_FILTERS.from ?? undefined,
      to: EXPORT_FILTERS.to ?? undefined,
      transactionType: 'promotion',
      pageSize: 100,
    }, signal)

    expect(postApiRoot).toHaveBeenCalledWith('/api/audit/exports', {
      clientId: CLIENT_ID,
      filters: {
        creditAccountId: ACCOUNT_ID,
        from: EXPORT_FILTERS.from,
        to: EXPORT_FILTERS.to,
        transactionType: 'promotion',
      },
    }, { responseType: 'text', signal })

    postApiRoot.mockResolvedValueOnce({
      data: acceptedJson({ filters: Object.fromEntries(Object.keys(EXPORT_FILTERS).map((key) => [key, null])) }),
      status: 202,
    })
    await requestBillingLedgerExport(CLIENT_ID, {})
    expect(postApiRoot.mock.calls[1]?.[1]).toEqual({ clientId: CLIENT_ID, filters: {} })
  })

  it('enforces accepted closed shape, UUIDv7, matching scope, pending state, and one timestamp', () => {
    expect(parseBillingLedgerExportAccepted(acceptedJson(), CLIENT_ID, EXPORT_FILTERS).exportId).toBe(EXPORT_ID)
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ exportId: '11111111-2222-3333-4444-555555555555' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('export identifier')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ status: 'processing' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('lifecycle')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ extra: 'private' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('closed contract')
    expect(() => parseBillingLedgerExportAccepted(
      acceptedJson({ clientId: 'ffffffff-1111-2222-3333-444444444444' }), CLIENT_ID, EXPORT_FILTERS
    )).toThrow('scope')
  })

  it('preserves Int64 lexemes, validates lifecycle fields, and separates the ephemeral reference', () => {
    const result = parseBillingLedgerExportStatus(statusJson(), EXPORT_ATTEMPT)
    expect(result.metadata.rowCount).toBe('9007199254740993')
    expect(result.metadata.byteSize).toBe('9223372036854775807')
    expect(result.reference).toEqual({
      value: 'opaque-bearer-reference', expiresAt: '2099-08-24T10:05:00+00:00',
    })
    expect(result.metadata).not.toHaveProperty('reference')

    expect(() => parseBillingLedgerExportStatus(statusJson({ rowCount: -1 }), EXPORT_ATTEMPT)).toThrow('Int64')
    expect(() => parseBillingLedgerExportStatus(statusJson({ status: 'pending' }), EXPORT_ATTEMPT)).toThrow('lifecycle')
    expect(() => parseBillingLedgerExportStatus(statusJson({ failureCode: 'raw_internal_code' }), EXPORT_ATTEMPT)).toThrow('classification')
    expect(() => parseBillingLedgerExportStatus(statusJson({ asOf: '2026-08-24T10:00:01+00:00' }), EXPORT_ATTEMPT)).toThrow('scope')
    expect(() => parseBillingLedgerExportStatus(statusJson({ unknown: 'value' }), EXPORT_ATTEMPT)).toThrow('closed contract')
  })

  it('gets status with cancellation and redeems once with the closed reference body', async () => {
    const signal = new AbortController().signal
    const getApiRoot = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({ data: statusJson(), status: 200 })
    const postApiRoot = vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: new Blob(['a,b\n1,2\n'], { type: 'text/csv; charset=utf-8' }),
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ledger-export-${EXPORT_ID}.csv"`,
      },
    })

    const status = await getBillingLedgerExportStatus(EXPORT_ATTEMPT, signal)
    await redeemBillingLedgerExport(EXPORT_ATTEMPT, status.reference!, signal)

    expect(getApiRoot).toHaveBeenCalledWith(`/api/audit/exports/${EXPORT_ID}`, { responseType: 'text', signal })
    expect(postApiRoot).toHaveBeenCalledWith(`/api/audit/exports/${EXPORT_ID}/redemptions`, {
      reference: 'opaque-bearer-reference',
    }, { responseType: 'blob', signal })
  })

  it('rejects a lookalike download media type before exposing a Blob', async () => {
    vi.spyOn(apiClient, 'postApiRoot').mockResolvedValue({
      data: new Blob(['not csv'], { type: 'text/csv-unsafe' }),
      status: 200,
      headers: { 'content-type': 'text/csv-unsafe' },
    })

    await expect(redeemBillingLedgerExport(EXPORT_ATTEMPT, {
      value: 'opaque-bearer-reference', expiresAt: '2099-08-24T10:05:00+00:00',
    })).rejects.toThrow('download response is invalid')
  })
})
