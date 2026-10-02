import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAiImageAdmission, useAiImageJobTracker } from './aiImageQueries'
import type { AiImageAdmissionQuote, AiImageAdmissionReceipt, AiImageJob } from '../types/aiImages'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JOB_ID = '01995d88-7740-73f1-8000-000000000001'
const KEY = '01995d88-7740-73f1-8000-000000000000'
const QUOTE_ID = 'iaq1_private-opaque-quote'

const quote: AiImageAdmissionQuote = {
  quoteId: QUOTE_ID, operation: 'image_generation', targetRole: 'hero', quotedCredits: '1.2345',
  ruleVersion: 'pricing-v9', issuedAt: '1970-01-01T00:00:00Z', expiresAt: '1970-01-01T00:01:40Z',
}

const receipt: AiImageAdmissionReceipt = {
  jobId: JOB_ID,
  reservationId: '01995d88-7740-73f1-8000-000000000002',
  eventId: '01995d88-7740-73f1-8000-000000000003', quotedCredits: '1.2345',
  status: 'reserved', correlationId: '01995d88-7740-73f1-8000-000000000004', replay: false,
}

function job(status: AiImageJob['status'], poll: boolean): AiImageJob {
  const terminal = ['completed', 'failed'].includes(status)
  return {
    jobId: JOB_ID, clientId: CLIENT_ID, requestType: 'image_generation', targetRole: 'hero', status,
    attemptCount: status === 'pending' ? 0 : 1,
    createdAt: '2026-10-02T08:00:00+00:00', updatedAt: '2026-10-02T08:00:01+00:00',
    processingStartedAt: status === 'pending' ? null : '2026-10-02T08:00:01+00:00',
    lastAttemptCompletedAt: terminal ? '2026-10-02T08:00:02+00:00' : null,
    completedAt: terminal ? '2026-10-02T08:00:02+00:00' : null,
    quote: { credits: '1.0000', ruleVersion: 'epic5-local-v1-hero' },
    reservation: {
      reservationId: receipt.reservationId,
      state: status === 'completed' ? 'committed' : status === 'failed' ? 'released' : 'active',
      estimatedCredits: '1.0000', actualCredits: status === 'completed' ? '0.7500' : null,
      createdAt: '2026-10-02T08:00:00+00:00', expiresAt: '2026-10-02T08:05:00+00:00',
      committedAt: status === 'completed' ? '2026-10-02T08:00:02+00:00' : null,
      releasedAt: status === 'failed' ? '2026-10-02T08:00:02+00:00' : null,
    },
    result: status === 'completed' ? {
      resultId: '01995d88-7740-73f1-8000-000000000005', mediaType: 'image/webp', width: 100, height: 50,
      byteSize: 4, observedAt: '2026-10-02T08:00:02+00:00', createdAt: '2026-10-02T08:00:02+00:00', expiresAt: '2026-10-09T08:00:02+00:00',
    } : null,
    resultAccess: status === 'completed' ? { reference: 'private-reference', expiresAt: '2026-10-02T08:05:02+00:00' } : null,
    guidance: status === 'completed' ? { code: 'completed', poll: false }
      : status === 'failed' ? { code: 'failed', poll: false }
        : { code: status, poll } as AiImageJob['guidance'],
  }
}

describe('AI image controllers', () => {
  afterEach(() => vi.restoreAllMocks())

  const flush = async (turns = 20) => {
    await act(async () => {
      for (let index = 0; index < turns; index += 1) await Promise.resolve()
    })
  }

  it('freezes one UUIDv7/body, blocks duplicate activation, and reuses it after uncertainty', async () => {
    const sent: string[] = []
    const post = vi.fn(async (body: string) => {
      sent.push(body)
      if (sent.length === 1) throw { code: 'NETWORK_ERROR', message: 'private transport detail' }
      return receipt
    })
    const { result } = renderHook(() => useAiImageAdmission({
      actorId: 'actor', clientId: CLIENT_ID, authorized: true,
      dependencies: { now: () => 0, uuid: () => KEY, quote: vi.fn(async () => quote), post },
    }))
    expect(result.current.review('  frozen prompt  ', 'hero')).toBe(true)
    await flush()
    expect(result.current.confirm('  frozen prompt  ', 'hero')).toBe(true)
    expect(result.current.confirm('  frozen prompt  ', 'hero')).toBe(false)
    expect(result.current.confirm('different', 'feature')).toBe(false)
    await flush()
    expect(result.current.state.phase).toBe('admission_unknown')
    expect(result.current.recover()).toBe(true)
    await flush()
    expect(result.current.state.phase).toBe('acknowledged')
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe(sent[1])
    expect(JSON.parse(sent[0]!)).toEqual({ idempotencyKey: KEY, prompt: 'frozen prompt', targetRole: 'hero', quoteId: QUOTE_ID })
    expect(sent[0]).not.toContain('1.2345')
  })

  it('treats a changed receipt amount as uncertain and replays the exact 1.2345-bound body', async () => {
    const sent: string[] = []
    const post = vi.fn(async (body: string) => {
      sent.push(body)
      return sent.length === 1 ? { ...receipt, quotedCredits: '1.0000' } : receipt
    })
    const { result } = renderHook(() => useAiImageAdmission({
      actorId: 'actor', clientId: CLIENT_ID, authorized: true,
      dependencies: { now: () => 0, uuid: () => KEY, quote: vi.fn(async () => quote), post },
    }))
    expect(result.current.review('fractional prompt', 'hero')).toBe(true)
    await flush()
    expect(result.current.confirm('fractional prompt', 'hero')).toBe(true)
    await flush()
    expect(result.current.state.phase).toBe('admission_unknown')
    expect(result.current.recover()).toBe(true)
    await flush()
    expect(result.current.state.phase).toBe('acknowledged')
    expect(sent[0]).toBe(sent[1])
    expect(JSON.parse(sent[0]!)).toMatchObject({ quoteId: QUOTE_ID, prompt: 'fractional prompt' })
  })

  it('does not quote invalid or unauthorized input and expires without silently requoting', async () => {
    vi.useFakeTimers()
    try {
      let now = 0
      const issue = vi.fn(async () => quote)
      const view = renderHook(({ authorized }) => useAiImageAdmission({
        actorId: 'actor', clientId: CLIENT_ID, authorized,
        dependencies: { now: () => now, quote: issue },
      }), { initialProps: { authorized: true } })
      expect(view.result.current.review('   ', 'hero')).toBe(false)
      expect(issue).not.toHaveBeenCalled()
      expect(view.result.current.review('valid', 'hero')).toBe(true)
      await flush()
      expect(view.result.current.state.quote?.quotedCredits).toBe('1.2345')
      now = 100_000
      await act(async () => { await vi.advanceTimersByTimeAsync(100_000) })
      expect(view.result.current.state.phase).toBe('quote_expired')
      expect(view.result.current.state.quote).toBeNull()
      expect(issue).toHaveBeenCalledTimes(1)
      view.rerender({ authorized: false })
      expect(view.result.current.review('valid', 'hero')).toBe(false)
      expect(issue).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['quote_expired', 'quote_expired'],
    ['quote_stale', 'quote_stale'],
    ['quote_not_available', 'quote_not_available'],
  ] as const)('clears %s admission failures and requires deliberate re-review', async (code, phase) => {
    const post = vi.fn(async () => { throw { status: code === 'quote_not_available' ? 422 : 409, code, message: 'private detail' } })
    const { result } = renderHook(() => useAiImageAdmission({
      actorId: 'actor', clientId: CLIENT_ID, authorized: true,
      dependencies: { now: () => 0, uuid: () => KEY, quote: vi.fn(async () => quote), post },
    }))
    expect(result.current.review('frozen prompt', 'hero')).toBe(true)
    await flush()
    expect(result.current.confirm('frozen prompt', 'hero')).toBe(true)
    await flush()
    expect(result.current.state.phase).toBe(phase)
    expect(result.current.state.quote).toBeNull()
    expect(result.current.recover()).toBe(false)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('runs one immediate GET followed by non-overlapping 1/2/4/8/10 second checks', async () => {
    let concurrent = 0
    let maximumConcurrent = 0
    const delays: number[] = []
    const values = [job('pending', true), job('processing', true), job('retrying', true), job('dlq', true), job('completed', false)]
    const get = vi.fn(async () => {
      concurrent += 1
      maximumConcurrent = Math.max(maximumConcurrent, concurrent)
      await Promise.resolve()
      concurrent -= 1
      return values.shift()!
    })
    const sleep = vi.fn(async (milliseconds: number) => { delays.push(milliseconds) })
    const { result } = renderHook(() => useAiImageJobTracker({
      actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
      dependencies: { now: () => 0, get, sleep },
    }))
    await flush(40)
    expect(result.current.state.phase).toBe('completed')
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(get).toHaveBeenCalledTimes(5)
    expect(maximumConcurrent).toBe(1)
    expect(result.current.state.job?.resultAccess).toBeNull()
    expect(JSON.stringify(result.current.state)).not.toContain('private-reference')
  })

  it('stops at the 60-second page budget and makes later checks deliberate GET-only', async () => {
    let now = 0
    const get = vi.fn(async () => job('pending', true))
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds })
    const { result } = renderHook(() => useAiImageJobTracker({
      actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
      dependencies: { now: () => now, get, sleep },
    }))
    await flush(60)
    expect(result.current.state.phase).toBe('timeout')
    expect(now).toBe(55_000)
    expect(get).toHaveBeenCalledTimes(9)
    expect(result.current.checkStatus()).toBe(true)
    await flush()
    expect(get).toHaveBeenCalledTimes(10)
    expect(result.current.state.phase).toBe('paused')
  })

  it('honors the real timer chain under fake timers without overlapping requests', async () => {
    vi.useFakeTimers()
    try {
      let now = 0
      const get = vi.fn(async () => job('pending', true))
      const { result } = renderHook(() => useAiImageJobTracker({
        actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
        dependencies: { get, now: () => now },
      }))
      await flush()
      expect(vi.getTimerCount()).toBe(2)
      for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000]) {
        now += delay
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay)
          await Promise.resolve()
        })
      }
      await flush()
      expect(get).toHaveBeenCalledTimes(9)
      expect(result.current.state.phase).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fences late responses and clears private preview on scope teardown', async () => {
    let resolveGet!: (value: AiImageJob) => void
    const get = vi.fn(() => new Promise<AiImageJob>((resolve) => { resolveGet = resolve }))
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private')
    const first = renderHook(({ clientId }) => useAiImageJobTracker({
      actorId: 'actor', clientId, jobId: JOB_ID, authorized: true,
      dependencies: { get, redeem: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })) },
    }), { initialProps: { clientId: CLIENT_ID } })
    first.unmount()
    resolveGet(job('completed', false))
    await act(async () => Promise.resolve())
    expect(first.result.current.state.job).toBeNull()

    const second = renderHook(() => useAiImageJobTracker({
      actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
      dependencies: { get: vi.fn(async () => job('completed', false)), redeem: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })) },
    }))
    await flush()
    expect(second.result.current.state.phase).toBe('completed')
    expect(second.result.current.viewResult()).toBe(true)
    await flush()
    expect(second.result.current.state.previewUrl).toBe('blob:private')
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    await flush()
    expect(second.result.current.state.job).toBeNull()
    expect(second.result.current.state.previewUrl).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:private')
    second.unmount()
  })

  it('enforces the automatic page deadline even when the initial GET never resolves', async () => {
    vi.useFakeTimers()
    try {
      const get = vi.fn(() => new Promise<AiImageJob>(() => undefined))
      const { result } = renderHook(() => useAiImageJobTracker({
        actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true, dependencies: { get },
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(result.current.state.phase).toBe('timeout')
      expect(get).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('purges protected state when private-result redemption loses authorization', async () => {
    const { result } = renderHook(() => useAiImageJobTracker({
      actorId: 'actor', clientId: CLIENT_ID, jobId: JOB_ID, authorized: true,
      dependencies: {
        get: vi.fn(async () => job('completed', false)),
        redeem: vi.fn(async () => { throw { status: 403, code: 'forbidden', message: 'raw' } }),
      },
    }))
    await flush()
    expect(result.current.viewResult()).toBe(true)
    await flush()
    expect(result.current.state.phase).toBe('permission_lost')
    expect(result.current.state.job).toBeNull()
    expect(result.current.state.previewUrl).toBeNull()
  })

  it('clears the prior private frame before a Client or permission scope renders', async () => {
    const never = new Promise<AiImageJob>(() => undefined)
    const get = vi.fn(async (clientId: string) => clientId === CLIENT_ID ? job('completed', false) : never)
    const view = renderHook(({ clientId, authorized }) => useAiImageJobTracker({
      actorId: 'actor', clientId, jobId: JOB_ID, authorized,
      dependencies: { get },
    }), { initialProps: { clientId: CLIENT_ID, authorized: true } })
    await flush()
    expect(view.result.current.state.job?.clientId).toBe(CLIENT_ID)
    view.rerender({ clientId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', authorized: true })
    await flush()
    expect(view.result.current.state.job).toBeNull()
    view.rerender({ clientId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', authorized: false })
    await flush()
    expect(view.result.current.state.phase).toBe('permission_lost')
    view.unmount()
  })
})
