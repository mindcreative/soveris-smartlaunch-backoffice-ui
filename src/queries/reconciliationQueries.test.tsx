import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useReconciliationWorkspace } from './reconciliationQueries'
import { queryReconciliation, findFreshReconciliationCase, resolveReconciliation } from '../api/reconciliationApi'
import { CLIENT, reconciliationFixture } from '../test/reconciliationFixture'
vi.mock('../api/reconciliationApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../api/reconciliationApi')>(), queryReconciliation: vi.fn(), findFreshReconciliationCase: vi.fn(), resolveReconciliation: vi.fn() }))
function setup() {
  const page = reconciliationFixture()
  vi.mocked(queryReconciliation).mockResolvedValue(page)
  vi.mocked(findFreshReconciliationCase).mockResolvedValue({ item: page.items[0]!, evaluatedAt: page.evaluatedAt })
  return { page, ...renderHook(() => useReconciliationWorkspace(CLIENT)) }
}
describe('reconciliation safety controller', () => {
  it('loads under React StrictMode setup/cleanup replay', async () => {
    vi.mocked(queryReconciliation).mockResolvedValue(reconciliationFixture())
    const { result } = renderHook(() => useReconciliationWorkspace(CLIENT), { wrapper: StrictMode })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
  })
  it('revalidates open and submit, retains exact operation on uncertainty and fences double activation', async () => {
    const { result, page } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.review(page.items[0]!, 'release_confirmed_non_execution'))
    vi.mocked(resolveReconciliation).mockRejectedValue({ code: 'NETWORK_ERROR' })
    await act(() => Promise.all([result.current.submit('Provider confirms no execution'), result.current.submit('Provider confirms no execution')]))
    expect(resolveReconciliation).toHaveBeenCalledTimes(1)
    const body = vi.mocked(resolveReconciliation).mock.calls[0]![0]
    expect(JSON.parse(body).operationId).toMatch(/-7[0-9a-f]{3}-[89ab]/)
    expect(result.current.outcome).toBe('unknown')
    await act(() => result.current.replay())
    expect(vi.mocked(resolveReconciliation).mock.calls[1]![0]).toBe(body)
    expect(findFreshReconciliationCase).toHaveBeenCalledTimes(2)
  })
  it('does not submit after a changed fingerprint', async () => {
    const { result, page } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.review(page.items[0]!, 'release_confirmed_non_execution'))
    vi.mocked(findFreshReconciliationCase).mockResolvedValue({ item: { ...page.items[0]!, evidenceFingerprint: 'd'.repeat(64) }, evaluatedAt: page.evaluatedAt })
    vi.mocked(resolveReconciliation).mockClear()
    await act(() => result.current.submit('Reviewed'))
    expect(resolveReconciliation).not.toHaveBeenCalled()
    expect(result.current.outcome).toBe('stale')
  })
  it('clears evidence and commands after denial', async () => {
    const { result, page } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.review(page.items[0]!, 'release_confirmed_non_execution'))
    vi.mocked(resolveReconciliation).mockRejectedValue({ status: 403 })
    await act(() => result.current.submit('Reviewed'))
    expect(result.current.denied).toBe(true)
    expect(result.current.items).toEqual([])
    expect(result.current.confirmation).toBeNull()
  })
  it('aborts obsolete requests and fences their late results on unmount', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(queryReconciliation).mockImplementation(async (_client, _filters, requestedSignal) => { signal = requestedSignal; return new Promise(() => {}) })
    const { unmount } = renderHook(() => useReconciliationWorkspace(CLIENT))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal!.aborted).toBe(true)
  })
})

describe('review remediation state regressions', () => {
  it('does not advance cursor or discard verified rows on duplicate continuation', async () => {
    const { result, page } = setup()
    page.nextCursor = 'valid-cursor'
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    vi.mocked(queryReconciliation).mockResolvedValue({ ...page, nextCursor: 'should-not-advance' })
    await act(() => result.current.load(undefined, true))
    expect(result.current.error).toBe(true)
    expect(result.current.page?.nextCursor).toBe('valid-cursor')
    expect(result.current.items).toHaveLength(1)
  })
  it('refuses changed operational evidence with an unchanged immutable evidence key fingerprint', async () => {
    const { result, page } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.review(page.items[0]!, 'release_confirmed_non_execution'))
    vi.mocked(findFreshReconciliationCase).mockResolvedValue({ item: { ...page.items[0]!, job: { ...page.items[0]!.job, updatedAt: '2026-10-05T09:00:00Z' } }, evaluatedAt: page.evaluatedAt })
    vi.mocked(resolveReconciliation).mockClear()
    await act(() => result.current.submit('Reviewed'))
    expect(resolveReconciliation).not.toHaveBeenCalled()
    expect(result.current.outcome).toBe('stale')
  })
  it('preserves reason and exact command until a deliberate replay reports known refusal or denial', async () => {
    const { result, page } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.review(page.items[0]!, 'release_confirmed_non_execution'))
    act(() => result.current.setReason('Required audit reason'))
    vi.mocked(resolveReconciliation).mockRejectedValueOnce({ status: 503, code: 'reconciliation_outcome_unknown' }).mockRejectedValueOnce({ status: 409, code: 'reconciliation_stale_case' })
    await act(() => result.current.submit(result.current.reason))
    expect(result.current.uncertain).toBe(true)
    await act(() => result.current.replay())
    expect(result.current.outcome).toBe('stale')
    expect(result.current.uncertain).toBe(false)
    expect(result.current.reason).toBe('Required audit reason')
  })
})
