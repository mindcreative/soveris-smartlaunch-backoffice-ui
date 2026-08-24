import { describe, expect, it, vi } from 'vitest'
import { apiClient } from './apiClient'
import { getBillingAccountSnapshot, parseBillingAccountSnapshot } from './billingApi'

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
