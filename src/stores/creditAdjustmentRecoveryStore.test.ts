import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreditAdjustmentAttempt } from '../types/billing'
import { creditAdjustmentRecoveryStore } from './creditAdjustmentRecoveryStore'

const ACTOR_A = '22222222-3333-4444-8555-666666666666'
const ACTOR_B = '33333333-4444-4555-8666-777777777777'
const CLIENT_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CLIENT_B = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const OPERATION = '0199b9d2-a9b1-7000-8000-000000000001'

function attempt(): CreditAdjustmentAttempt {
  return {
    actorUserId: ACTOR_A,
    clientId: CLIENT_A,
    creditAccountId: '11111111-2222-4333-8444-555555555555',
    route: `/api/billing/clients/${CLIENT_A}/credit-adjustments`,
    operationId: OPERATION,
    request: {
      operationId: OPERATION, expectedWalletVersion: '12', amount: '-25.5000', reason: 'Correction',
    },
    serializedBody: `{"operationId":"${OPERATION}","expectedWalletVersion":12,"amount":-25.5000,"reason":"Correction"}`,
    semanticFingerprint: 'private-fingerprint',
    dispatchedAt: '2026-09-24T12:00:00.000Z',
  }
}

afterEach(() => creditAdjustmentRecoveryStore.clearForTests())

describe('credit adjustment recovery registry', () => {
  it('retains one frozen attempt only for the exact actor and Client scope', () => {
    const retained = creditAdjustmentRecoveryStore.retain(attempt())
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.request)).toBe(true)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR_A, CLIENT_A)).toMatchObject({
      operationId: OPERATION, quarantined: false,
    })
    expect(creditAdjustmentRecoveryStore.peek(ACTOR_B, CLIENT_A)).toBeNull()
    expect(creditAdjustmentRecoveryStore.peek(ACTOR_A, CLIENT_B)).toBeNull()
    expect(() => creditAdjustmentRecoveryStore.retain({ ...attempt(), operationId:
      '0199b9d2-a9b1-7000-8000-000000000002' })).toThrow()
  })

  it('quarantines on authority loss, adopts only in the restored matching scope, and retires exactly', () => {
    creditAdjustmentRecoveryStore.retain(attempt())
    creditAdjustmentRecoveryStore.quarantine(ACTOR_A, CLIENT_A)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR_A, CLIENT_A)?.quarantined).toBe(true)
    expect(creditAdjustmentRecoveryStore.adopt(ACTOR_B, CLIENT_A)).toBeNull()
    expect(creditAdjustmentRecoveryStore.adopt(ACTOR_A, CLIENT_A)?.quarantined).toBe(false)
    expect(creditAdjustmentRecoveryStore.retire(ACTOR_A, CLIENT_A,
      '0199b9d2-a9b1-7000-8000-000000000002')).toBe(false)
    expect(creditAdjustmentRecoveryStore.retire(ACTOR_A, CLIENT_A, OPERATION)).toBe(true)
    expect(creditAdjustmentRecoveryStore.peek(ACTOR_A, CLIENT_A)).toBeNull()
  })

  it('warns before unload only while any unresolved record exists', () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const prevent = vi.spyOn(event, 'preventDefault')
    creditAdjustmentRecoveryStore.retain(attempt())
    window.dispatchEvent(event)
    expect(prevent).toHaveBeenCalledOnce()

    creditAdjustmentRecoveryStore.retire(ACTOR_A, CLIENT_A, OPERATION)
    const settled = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const settledPrevent = vi.spyOn(settled, 'preventDefault')
    window.dispatchEvent(settled)
    expect(settledPrevent).not.toHaveBeenCalled()
  })
})
