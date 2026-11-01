import { describe, expect, it, vi } from 'vitest'
import { createMfaFlow } from './mfaFlow'
import { MFA_ROUTES } from './constants/mfa'
import type { MfaBoundChallenge } from './models/mfa'

function fixture() {
  let now = 1_000_000
  let epoch = 1
  let session = 'session-A'
  const flow = createMfaFlow({ now: () => now, epoch: () => epoch, session: () => session })
  const bound: MfaBoundChallenge = { challenge: { id: '01990000-0000-7000-8000-000000000009', secret: 'A'.repeat(43),
    purpose: 'login', expiresAt: new Date(now + 300_000).toISOString(), attemptsRemaining: 5 }, csrfToken: 'B'.repeat(43) }

  return { flow, bound, advance: (seconds: number) => { now += seconds * 1000 }, retire: () => { epoch++ }, switch: () => { session = 'session-B' } }
}

describe('MFA memory ownership', () => {
  it('never persists its pending proof and cancels the previous operation', () => {
    const state = fixture()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    state.flow.setLogin(state.bound)
    const first = state.flow.begin()
    const second = state.flow.begin()
    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })

  it.each(['session', 'epoch'] as const)('rejects late completion after %s changed before a queued browser event', change => {
    const state = fixture()
    const operation = state.flow.begin()
    if (change === 'session') state.switch()
    else state.retire()
    expect(operation.isCurrent()).toBe(false)
  })

  it('preserves an explicitly offered MFA handoff and clears an abandoned or history navigation', () => {
    const state = fixture()
    state.flow.setLogin(state.bound)
    state.flow.offerHandoff(MFA_ROUTES.challenge)
    state.flow.navigate(MFA_ROUTES.challenge)
    expect(state.flow.snapshot().login).not.toBeNull()
    const operation = state.flow.begin()
    state.flow.navigate('/products')
    expect(state.flow.snapshot().login).toBeNull()
    expect(operation.pageIsCurrent()).toBe(false)
    state.flow.navigate(MFA_ROUTES.challenge)
    expect(state.flow.snapshot().login).toBeNull()
  })

  it('retires exact-expiry proof and cannot revive an expired challenge', () => {
    const state = fixture()
    state.flow.setLogin(state.bound)
    const operation = state.flow.begin()
    state.advance(300)
    state.flow.expire()
    expect(state.flow.snapshot().login).toBeNull()
    expect(operation.isCurrent()).toBe(false)
  })

  it('keeps original recovery and independently bound fresh primary without extending the recovery expiry', () => {
    const state = fixture()
    const continuation = { id: state.bound.challenge.id, secret: state.bound.challenge.secret, csrfToken: state.bound.csrfToken, expiresAt: state.bound.challenge.expiresAt }
    state.flow.setRecovery(continuation)
    state.flow.setFreshRecoveryPrimary({ ...state.bound, csrfToken: 'C'.repeat(43) })
    expect(state.flow.snapshot().recovery).toEqual(continuation)
    state.advance(300)
    state.flow.expire()
    expect(state.flow.snapshot().recovery).toBeNull()
    expect(state.flow.snapshot().freshRecoveryPrimary).toBeNull()
  })

  it('shows one bounded code set and cannot reopen it after leaving the display', () => {
    const state = fixture()
    state.flow.setCodes(['synthetic-display-canary'])
    expect(state.flow.snapshot().codes).toHaveLength(1)
    state.flow.navigate('/login')
    state.flow.navigate(MFA_ROUTES.enroll)
    expect(state.flow.snapshot().codes).toBeNull()
    state.flow.setCodes(['synthetic-display-canary'])
    state.advance(600)
    state.flow.expire()
    expect(state.flow.snapshot().codes).toBeNull()
  })
})
