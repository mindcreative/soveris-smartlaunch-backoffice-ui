import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DomainTracker, domainIsActive } from './domainTracker'
import type { DomainLookup } from '../types/domains'
import { parseDomain } from '../api/domainContracts'
import fixture from '../api/__fixtures__/domains-http.json'
const detailWire = fixture.cases.find(c => c.name === 'detail')!.responseBody
const pending: DomainLookup = { kind: 'domain', domain: parseDomain(detailWire, JSON.parse(detailWire).clientId) }
const primaryWire = fixture.cases.find(c => c.name === 'primary')!.responseBody
const active: DomainLookup = { kind: 'domain', domain: parseDomain(primaryWire, JSON.parse(primaryWire).clientId) }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const flush = () => vi.advanceTimersByTimeAsync(0)
it('keeps one GET in flight, deduplicates starts and schedules only after completion', async () => {
  let resolve!: (value: DomainLookup) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise<DomainLookup>(r => { resolve = r })).mockResolvedValue(pending)
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  expect(tracker.start()).toBe(true); expect(tracker.start()).toBe(false)
  await vi.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(1)
  resolve(pending); await flush()
  await vi.advanceTimersByTimeAsync(4999); expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2)
  tracker.pause()
})
it('times out an unresponsive GET at 15 seconds and fences its late reply', async () => {
  let resolve!: (value: DomainLookup) => void
  const read = vi.fn((_signal: AbortSignal) => new Promise<DomainLookup>(r => { resolve = r }))
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await vi.advanceTimersByTimeAsync(15000)
  expect(tracker.snapshot().phase).toBe('unavailable')
  expect(read.mock.calls[0]![0].aborted).toBe(true)
  resolve(active); await flush(); expect(tracker.snapshot().value).toBeNull()
})
it('stops at exactly sixty status GETs or five elapsed minutes', async () => {
  const read = vi.fn().mockResolvedValue(pending)
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await vi.advanceTimersByTimeAsync(300000)
  expect(read).toHaveBeenCalledTimes(60); expect(tracker.snapshot().phase).toBe('timeout')
  await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(60)
  tracker.start(); await flush(); expect(read).toHaveBeenCalledTimes(61); tracker.pause()
})
it('honors server timing and rejects early manual checks during the embargo', async () => {
  const read = vi.fn().mockRejectedValueOnce({ status: 503, retryAfterSeconds: 17, message: 'Unavailable' }).mockResolvedValue(pending)
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await flush(); expect(tracker.start()).toBe(false)
  await vi.advanceTimersByTimeAsync(16999); expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2); tracker.pause()
})
it('purges denied private state and rejects a response after authority changes', async () => {
  let current = true
  const read = vi.fn().mockResolvedValue(pending)
  const tracker = new DomainTracker({ read, current: () => current, now: () => Date.now() })
  tracker.start(); await flush(); current = false
  await vi.advanceTimersByTimeAsync(5000); expect(tracker.snapshot().value).toBeNull()
  expect(tracker.snapshot().phase).toBe('denied')
})
it('subtracts complete in-flight time from serving freshness and removes Active at equality', async () => {
  const read = vi.fn(() => new Promise<DomainLookup>(r => setTimeout(() => r(active), 2000)))
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await vi.advanceTimersByTimeAsync(2000)
  expect(domainIsActive(tracker.snapshot(), Date.now())).toBe(true)
  await vi.advanceTimersByTimeAsync(3000)
  expect(domainIsActive(tracker.snapshot(), Date.now())).toBe(false)
  tracker.pause()
})
it('retains immutable release identity through pending, action_required and explicit released recovery', async () => {
  const sample = fixture.cases.find(c => c.name === 'release-status')!
  const receipt = JSON.parse(sample.responseBody)
  const read = vi.fn().mockResolvedValueOnce({ kind: 'release', release: receipt })
    .mockResolvedValueOnce({ kind: 'release', release: { ...receipt, state: 'action_required', lastErrorCode: 'provider_failure' } })
    .mockResolvedValueOnce({ kind: 'release', release: { ...receipt, state: 'released', completedAt: receipt.requestedAt } })
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await flush(); await vi.advanceTimersByTimeAsync(5000)
  expect(tracker.snapshot().value?.kind).toBe('release'); expect(tracker.snapshot().phase).toBe('idle')
  await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(2)
  tracker.start(); await flush()
  expect((tracker.snapshot().value as { release: { state: string } }).release.state).toBe('released')
  expect(domainIsActive(tracker.snapshot(), Date.now())).toBe(false)
  tracker.pause()
})
it('counts cold fallback GETs individually within the sixty-request ceiling', async () => {
  const receipt = JSON.parse(fixture.cases.find(c => c.name === 'release-status')!.responseBody)
  let gets = 0
  const read = vi.fn(async (_signal: AbortSignal, additional: () => boolean): Promise<DomainLookup> => {
    gets++
    if (gets === 1 && additional()) gets++
    return { kind: 'release', release: receipt }
  })
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await vi.advanceTimersByTimeAsync(300000)
  expect(gets).toBe(60); expect(tracker.snapshot().attempts).toBe(60); expect(tracker.snapshot().phase).toBe('timeout')
})
it('rejects a different release identity rather than applying it to the tracked domain', async () => {
  const receipt = JSON.parse(fixture.cases.find(c => c.name === 'release-status')!.responseBody)
  const read = vi.fn().mockResolvedValueOnce({ kind: 'release', release: receipt })
    .mockResolvedValueOnce({ kind: 'release', release: { ...receipt, releaseId: '01990000-0000-7000-8000-000000000002' } })
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await vi.advanceTimersByTimeAsync(5000)
  expect(tracker.snapshot().phase).toBe('contract_error'); expect(tracker.snapshot().value).toBeNull()
})
it('keeps checking the real proof-to-edge discovery gap until TLS and routing settle', async () => {
  if (pending.kind !== 'domain') throw new Error('fixture')
  const between: DomainLookup = { kind: 'domain', domain: { ...pending.domain,
    ownership: { ...pending.domain.ownership, status: 'verified' }, edge: null } }
  const read = vi.fn().mockResolvedValueOnce(between).mockResolvedValue(active)
  const tracker = new DomainTracker({ read, current: () => true, now: () => Date.now() })
  tracker.start(); await flush()
  expect(tracker.snapshot().phase).toBe('tracking')
  await vi.advanceTimersByTimeAsync(5000)
  expect(domainIsActive(tracker.snapshot(), Date.now())).toBe(true)
  expect(tracker.snapshot().phase).toBe('idle')
})
