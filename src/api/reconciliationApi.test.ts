import { describe, it, expect, vi } from 'vitest'
import { apiClient } from './apiClient'
import { queryReconciliation, resolveReconciliation, parseReconciliationPage, reconciliationOutcome, resolutionProof, ReconciliationCommandError } from './reconciliationApi'
import { reconciliationFixture, CLIENT, FINDING, JOB, RESERVATION, PROOF } from '../test/reconciliationFixture'
vi.mock('./apiClient', () => ({ apiClient: { getApiRoot: vi.fn(), postApiRoot: vi.fn() } }))
describe('closed reconciliation contract', () => {
  it('accepts immutable decimal evidence and rejects cross-Client or unknown fields', () => {
    const page = reconciliationFixture()
    expect(parseReconciliationPage(page, CLIENT).items[0]!.reservation.estimatedCredits).toBe('2.2500')
    expect(() => parseReconciliationPage({ ...page, secret: 'private' }, CLIENT)).toThrow()
    page.items[0]!.job.clientId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
  })
  it('sends continuation with clientId and cursor only and disables transparent auth replay', async () => {
    vi.mocked(apiClient.getApiRoot).mockResolvedValue({ data: reconciliationFixture(), status: 200 })
    await queryReconciliation(CLIENT, { cursor: 'opaque' }, new AbortController().signal)
    expect(apiClient.getApiRoot).toHaveBeenCalledWith('/api/billing/reconciliation', expect.objectContaining({ params: { clientId: CLIENT, cursor: 'opaque' }, retryOnUnauthorized: false }))
    await expect(queryReconciliation(CLIENT, { cursor: 'opaque', severity: 'error' } as never)).rejects.toThrow()
  })
  it('retains exact command bytes and treats malformed acknowledgements as unknown', async () => {
    vi.mocked(apiClient.postApiRoot).mockResolvedValue({ status: 200, data: {} })
    const body = JSON.stringify({ operationId: FINDING, clientId: CLIENT, findingId: FINDING, jobId: JOB, reservationId: RESERVATION, action: 'release_confirmed_non_execution', reason: 'Verified proof', expectedCaseVersion: 'case-token', evidenceFingerprint: 'c'.repeat(64), providerProofId: PROOF })
    await expect(resolveReconciliation(body)).rejects.toThrow()
    expect(apiClient.postApiRoot).toHaveBeenCalledWith('/api/billing/reconciliation/resolutions', body, expect.objectContaining({ retryOnUnauthorized: false }))
  })
  it.each([[{ status: 403 }, 'denied'], [{ status: 401 }, 'denied'], [{ status: 409 }, 'stale'], [{ status: 503, code: 'reconciliation_outcome_unknown' }, 'unknown'], [{ code: 'NETWORK_ERROR' }, 'unknown']])('classifies %j safely', (error, expected) => expect(reconciliationOutcome(error)).toBe(expected))
  it('selects proof only for server-authorized actions', () => {
    const item = reconciliationFixture().items[0]!
    expect(resolutionProof(item, 'release_confirmed_non_execution')).toBe(item.providerProofs[0]!.providerProofId)
    expect(() => resolutionProof(item, 'authorize_safe_reexecution')).toThrow()
  })
})

describe('reconciliation evidence and fresh lookup regressions', () => {
  it('preserves orphan evidence without inventing a canonical Job', () => {
    const page = reconciliationFixture(); const item = page.items[0]!
    item.job.jobId = null; item.job.reservationId = null; item.allowedActions = []; item.finding.findingType = 'evidence_mismatch'
    expect(parseReconciliationPage(page, CLIENT).items[0]!.reservation.jobId).toBe(JOB)
  })
  it.each(['finding', 'job', 'reservation', 'correlation'])('rejects extra nested %s fields', field => {
    const page = reconciliationFixture()
    Object.assign(page.items[0]![field as 'finding'], { privateUrl: 'do-not-display' })
    expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
  })
  it('keeps large exact decimal strings, rejecting rounded numbers and unsafe actions', () => {
    const page = reconciliationFixture(); page.items[0]!.reservation.estimatedCredits = '99999999999999.9999'
    expect(parseReconciliationPage(page, CLIENT).items[0]!.reservation.estimatedCredits).toBe('99999999999999.9999')
    page.items[0]!.reservation.estimatedCredits = 2.25 as never
    expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
    page.items[0]!.reservation.estimatedCredits = '2.2500'; page.items[0]!.allowedActions = ['blind_retry']
    expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
  })
  it('ignores expired/mismatched provider proof and requires unbounded retry guarantee', () => {
    const item = reconciliationFixture().items[0]!
    item.providerProofs.push({ ...item.providerProofs[0]!, providerProofId: FINDING, providerOperationId: 'another-operation' })
    expect(resolutionProof(item, 'release_confirmed_non_execution')).toBe(PROOF)
    item.allowedActions = ['authorize_safe_reexecution']; item.providerProofs[0]!.proofType = 'deduplicated_replay_safe'
    expect(() => resolutionProof(item, 'authorize_safe_reexecution')).toThrow()
    item.providerProofs[0]!.validityMode = 'unbounded_key_lifetime'
    expect(resolutionProof(item, 'authorize_safe_reexecution')).toBe(PROOF)
  })
  it('refuses malformed commands before sending and never defaults a missing proof', async () => {
    vi.mocked(apiClient.postApiRoot).mockClear()
    await expect(resolveReconciliation(JSON.stringify({ operationId: FINDING }))).rejects.toBeInstanceOf(ReconciliationCommandError)
    expect(reconciliationOutcome(new ReconciliationCommandError())).toBe('error')
    expect(apiClient.postApiRoot).not.toHaveBeenCalled()
  })
  it('locates a case beyond 100 pages without misreporting it as absent', async () => {
    const { findFreshReconciliationCase } = await import('./reconciliationApi')
    let count = 0
    vi.mocked(apiClient.getApiRoot).mockImplementation(async () => {
      const page = reconciliationFixture(); count++
      if (count <= 101) { page.items[0]!.finding.findingId = `01995d88-7740-73f1-8000-${(count + 10).toString(16).padStart(12, '0')}`; page.nextCursor = `cursor-${count}` }
      return { status: 200, data: page }
    })
    expect((await findFreshReconciliationCase(CLIENT, FINDING, new AbortController().signal)).item.finding.findingId).toBe(FINDING)
    expect(count).toBe(102)
  })
  it('rejects changing snapshot membership before accepting a target case', async () => {
    const { findFreshReconciliationCase } = await import('./reconciliationApi')
    const first = { ...reconciliationFixture(), items: [], nextCursor: 'next' }
    const second = { ...reconciliationFixture(), asOf: '2026-10-05T09:00:00Z' }
    vi.mocked(apiClient.getApiRoot).mockResolvedValueOnce({ status: 200, data: first }).mockResolvedValueOnce({ status: 200, data: second })
    await expect(findFreshReconciliationCase(CLIENT, FINDING, new AbortController().signal)).rejects.toThrow()
  })
})

it('rejects UUIDv4 case/proof identifiers before the workspace can retain a command', () => {
  const page = reconciliationFixture()
  page.items[0]!.finding.findingId = CLIENT
  expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
  page.items[0]!.finding.findingId = FINDING
  page.items[0]!.providerProofs[0]!.providerProofId = CLIENT
  expect(() => parseReconciliationPage(page, CLIENT)).toThrow()
})
