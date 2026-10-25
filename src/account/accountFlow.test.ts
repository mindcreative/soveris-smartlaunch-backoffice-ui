import { describe, expect, it } from 'vitest'
import { createAccountFlow } from './accountFlow'

describe('bounded memory account flow', () => {
  function fixture() {
    let now = 1000
    let epoch = 0
    let session = ''
    const flow = createAccountFlow({ now: () => now, epoch: () => epoch, session: () => session })

    return { flow, advance: (duration: number) => { now += duration }, retire: () => { epoch++ }, switchSession: () => { session = 'replacement' } }
  }

  it('retains absolute pending expiry without adding it to browser storage', () => {
    const { flow, advance } = fixture()
    flow.setPending({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 60 }, 'test@example.test')

    expect(flow.pending()?.email).toBe('test@example.test')
    advance(60001)
    expect(flow.pending()).toBeNull()
  })

  it('does not extend pending lifetime by request latency', () => {
    const { flow, advance } = fixture()
    const requestStartedAt = 1000
    advance(3000)
    flow.setPending({ status: 'check_email', pendingToken: 'A'.repeat(43), expiresIn: 60 }, 'test@example.test', requestStartedAt)

    expect(flow.pending()?.expiresAt).toBe(61000)
  })

  it.each(['retire', 'switchSession'] as const)('fences a late action on %s before browser events arrive', change => {
    const state = fixture()
    const operation = state.flow.begin()
    state[change]()

    expect(operation.isCurrent()).toBe(false)
  })

  it('invalidates old operations when abandoning without restoring secrets', () => {
    const { flow } = fixture()
    flow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: 100000 })
    const old = flow.begin()
    flow.clear()

    expect(old.isCurrent()).toBe(false)
    expect(old.signal.aborted).toBe(true)
    expect(flow.proof('verify')).toBeNull()
  })

  it('keeps generic invalid-proof fallback available only within the original proof lifetime', () => {
    const { flow, advance } = fixture()
    flow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: 2000 })

    expect(flow.proof('verify')).toBe('A'.repeat(43))
    expect(flow.proof('reset')).toBeNull()
    advance(1001)
    expect(flow.proof('verify')).toBeNull()
  })

  it('distinguishes same-page authority retirement from leaving and returning to the proof page', () => {
    const { flow } = fixture()
    const operation = flow.begin()
    flow.clear()

    expect(operation.isCurrent()).toBe(false)
    expect(operation.pageIsCurrent()).toBe(true)
    flow.leavePage()
    expect(operation.pageIsCurrent()).toBe(false)
  })

  it('retains only the original proof expiry through deliberate sign-out continuation', () => {
    const { flow, advance } = fixture()
    flow.setProof({ kind: 'verify', proof: 'A'.repeat(43), expiresAt: 2000 })
    const proof = flow.releaseProof('verify')
    flow.clear()
    expect(proof?.expiresAt).toBe(2000)
    expect(flow.proof('verify')).toBeNull()

    if (proof) {
      flow.setProof(proof)
    }

    advance(1001)
    expect(flow.proof('verify')).toBeNull()
  })
})
