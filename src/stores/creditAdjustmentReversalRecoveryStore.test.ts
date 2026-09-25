import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreditAdjustmentReversalAttempt } from '../types/billing'
import { creditAdjustmentReversalRecoveryStore } from './creditAdjustmentReversalRecoveryStore'

const ACTOR = '22222222-3333-4444-8555-666666666666'
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ORIGINAL = '0199b9d2-a9b1-7000-8000-000000000003'
const OPERATION = '0199b9d2-a9b1-7000-8000-000000000005'

function attempt(): CreditAdjustmentReversalAttempt {
  return {
    actorUserId: ACTOR, clientId: CLIENT, originalAdjustmentId: ORIGINAL,
    creditAccountId: '0199b9d2-a9b1-7000-8000-000000000002',
    route: `/api/backoffice/clients/${CLIENT}/billing/adjustments/${ORIGINAL}/reversal`,
    operationId: OPERATION,
    request: { operationId: OPERATION, expectedWalletVersion: '13', reason: 'Compensate' },
    serializedBody: `{"operationId":"${OPERATION}","expectedWalletVersion":13,"reason":"Compensate"}`,
    semanticFingerprint: 'sealed-private-evidence', dispatchedAt: '2026-09-24T12:00:00Z',
    account: {
      creditAccountId: '0199b9d2-a9b1-7000-8000-000000000002', clientId: CLIENT,
      ownedBalance: '74.5000', activelyReservedAmount: '20.0000',
      availableBalance: '54.5000', activeReservationCount: 1, status: 'active',
      asOf: '2026-09-24T14:00:00.000000', walletVersion: '13',
    },
    original: {
      schemaVersion: 1, clientId: CLIENT,
      creditAccountId: '0199b9d2-a9b1-7000-8000-000000000002',
      operationId: '0199b9d2-a9b1-7000-8000-000000000001', adjustmentId: ORIGINAL,
      ledgerId: '0199b9d2-a9b1-7000-8000-000000000004', operationType: 'original',
      amount: '-25.5000', reason: 'Original', performedBy: ACTOR,
      expectedWalletVersion: '12', walletVersionBefore: '12', walletVersionAfter: '13',
      beforeOwnedBalance: '100.0000', beforeReservedBalance: '20.0000',
      beforeAvailableBalance: '80.0000', afterOwnedBalance: '74.5000',
      afterReservedBalance: '20.0000', afterAvailableBalance: '54.5000',
      operationAsOf: '2026-09-24T13:00:00.000000',
      originalAdjustmentId: null, reversalAdjustmentId: null,
    },
  }
}

afterEach(() => creditAdjustmentReversalRecoveryStore.clearForTests())

describe('credit adjustment reversal recovery store', () => {
  it('deep-freezes one exact attempt per actor, Client and original', () => {
    const retained = creditAdjustmentReversalRecoveryStore.retain(attempt())
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.request)).toBe(true)
    expect(Object.isFrozen(retained.account)).toBe(true)
    expect(Object.isFrozen(retained.original)).toBe(true)
    expect(creditAdjustmentReversalRecoveryStore.peek(ACTOR, CLIENT, ORIGINAL))
      .toMatchObject({ operationId: OPERATION, quarantined: false })
    expect(() => creditAdjustmentReversalRecoveryStore.retain({
      ...attempt(), operationId: '0199b9d2-a9b1-7000-8000-000000000006',
    })).toThrow()
  })

  it('quarantines, adopts and retires only the exact compatible scope', () => {
    creditAdjustmentReversalRecoveryStore.retain(attempt())
    creditAdjustmentReversalRecoveryStore.quarantine(ACTOR, CLIENT, ORIGINAL)
    expect(creditAdjustmentReversalRecoveryStore.adopt(
      ACTOR, CLIENT, '0199b9d2-a9b1-7000-8000-000000000009')).toBeNull()
    expect(creditAdjustmentReversalRecoveryStore.adopt(ACTOR, CLIENT, ORIGINAL)?.quarantined)
      .toBe(false)
    expect(creditAdjustmentReversalRecoveryStore.retire(
      ACTOR, CLIENT, ORIGINAL, '0199b9d2-a9b1-7000-8000-000000000009')).toBe(false)
    expect(creditAdjustmentReversalRecoveryStore.retire(
      ACTOR, CLIENT, ORIGINAL, OPERATION)).toBe(true)
  })

  it('finds a compatible unresolved attempt without crossing actor or Client', () => {
    creditAdjustmentReversalRecoveryStore.retain(attempt())
    expect(creditAdjustmentReversalRecoveryStore.first(ACTOR, CLIENT)?.operationId).toBe(OPERATION)
    expect(creditAdjustmentReversalRecoveryStore.first('33333333-4444-4555-8666-777777777777', CLIENT))
      .toBeNull()
  })

  it('warns before unload only while an unresolved reversal exists', () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const prevent = vi.spyOn(event, 'preventDefault')
    creditAdjustmentReversalRecoveryStore.retain(attempt())
    window.dispatchEvent(event)
    expect(prevent).toHaveBeenCalledOnce()
    creditAdjustmentReversalRecoveryStore.clearScope(ACTOR, CLIENT)
    const settled = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const settledPrevent = vi.spyOn(settled, 'preventDefault')
    window.dispatchEvent(settled)
    expect(settledPrevent).not.toHaveBeenCalled()
  })
})
