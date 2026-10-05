import { apiClient } from './apiClient'
import { validateReconciliationPage, validateReconciliationResolution, RECONCILIATION_ACTIONS, type ReconciliationAction, type ReconciliationCase, type ReconciliationPage, type ReconciliationResolution } from '../types/reconciliation'
export const FINDING_TYPES = ['expired_waiting', 'stale_pre_dispatch', 'completed_active_reservation', 'execution_unknown', 'evidence_mismatch'] as const
export interface ReconciliationFilters {
  type?: typeof FINDING_TYPES[number]; minimumAgeSeconds?: number; severity?: 'warning' | 'error' | 'critical'; resolutionStatus?: 'open' | 'resolved'; pageSize?: number
}
export interface ResolutionCommand {
  operationId: string; clientId: string; findingId: string; jobId: string; reservationId: string; action: ReconciliationAction; reason: string; expectedCaseVersion: string; evidenceFingerprint: string; providerProofId: string | null
}
export class ReconciliationContractError extends Error { constructor() { super('Reconciliation response could not be verified.') } }
export class ReconciliationCommandError extends ReconciliationContractError {
  readonly status = 400
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isReconciliationClient = (value: string) => uuid.test(value) && value !== '00000000-0000-0000-0000-000000000000'
export function parseReconciliationPage(value: unknown, clientId: string): ReconciliationPage {
  if (!validateReconciliationPage(value) || value.clientId !== clientId) throw new ReconciliationContractError()
  const ids = new Set<string>()
  for (const item of value.items) {
    if (item.job.clientId !== clientId || (item.usage && item.usage.clientId !== clientId) || ids.has(item.finding.findingId) || !FINDING_TYPES.includes(item.finding.findingType as never) || !['warning', 'error', 'critical'].includes(item.finding.severity) || !['open', 'resolved'].includes(item.finding.resolutionStatus)) throw new ReconciliationContractError()
    ids.add(item.finding.findingId)
    if (item.job.jobId && (item.job.reservationId !== item.reservation.reservationId || item.reservation.jobId !== item.job.jobId)) throw new ReconciliationContractError()
    for (const linked of [item.result, item.usage, ...item.providerCosts]) if (linked && (!item.job.jobId || linked.jobId !== item.job.jobId)) throw new ReconciliationContractError()
    if (item.usage && (item.usage.reservationId !== item.reservation.reservationId || item.usage.accountId !== item.reservation.accountId)) throw new ReconciliationContractError()
    if (item.allowedActions.length && (item.finding.resolutionStatus !== 'open' || !item.job.jobId || !item.reservation.reservationId)) throw new ReconciliationContractError()
  }
  return value
}
export async function queryReconciliation(clientId: string, query: ReconciliationFilters | { cursor: string } = {}, signal?: AbortSignal) {
  if (!isReconciliationClient(clientId)) throw new ReconciliationContractError()
  const keys = Object.keys(query)
  if ('cursor' in query) {
    if (keys.length !== 1 || !query.cursor.trim()) throw new ReconciliationContractError()
  } else if (keys.some(k => !['type', 'minimumAgeSeconds', 'severity', 'resolutionStatus', 'pageSize'].includes(k)) ||
    (query.minimumAgeSeconds !== undefined && (!Number.isInteger(query.minimumAgeSeconds) || query.minimumAgeSeconds < 0 || query.minimumAgeSeconds > 2147483647)) ||
    (query.pageSize !== undefined && (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100)) ||
    (query.type !== undefined && !FINDING_TYPES.includes(query.type)) || (query.severity !== undefined && !['warning', 'error', 'critical'].includes(query.severity)) || (query.resolutionStatus !== undefined && !['open', 'resolved'].includes(query.resolutionStatus))) throw new ReconciliationContractError()
  const response = await apiClient.getApiRoot<unknown>('/api/billing/reconciliation', { params: { clientId, ...query }, signal, retryOnUnauthorized: false })
  if (response.status !== 200) throw new ReconciliationContractError()
  return parseReconciliationPage(response.data, clientId)
}
export async function findFreshReconciliationCase(clientId: string, findingId: string, signal: AbortSignal): Promise<{ item: ReconciliationCase; evaluatedAt: string }> {
  let cursor: string | undefined
  const cursors = new Set<string>()
  const findings = new Set<string>()
  const started = performance.now()
  let asOf: string | undefined
  while (true) {
    if (performance.now() - started > 60000) throw new Error('Fresh case lookup exceeded its time budget.')
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const page = await queryReconciliation(clientId, cursor ? { cursor } : { pageSize: 100 }, signal)
    if (asOf && asOf !== page.asOf) throw new ReconciliationContractError()
    asOf = page.asOf
    for (const row of page.items) {
      if (findings.has(row.finding.findingId)) throw new ReconciliationContractError()
      findings.add(row.finding.findingId)
    }
    const item = page.items.find(row => row.finding.findingId === findingId)
    if (item) return { item, evaluatedAt: page.evaluatedAt }
    if (!page.nextCursor) break
    if (cursors.has(page.nextCursor)) throw new ReconciliationContractError()
    cursors.add(page.nextCursor); cursor = page.nextCursor
  }
  throw { code: 'reconciliation_case_not_found', status: 404 }
}
export function normalizeReconciliationReason(raw: string): string {
  const reason = raw.normalize('NFC').trim()
  if (!reason || [...reason].length > 1000 || /[\u0000-\u001f\u007f-\u009f]/.test(reason)) throw new Error('Enter a reason of 1–1000 characters without control characters.')
  return reason
}
export function resolutionProof(item: ReconciliationCase, action: ReconciliationAction, evaluatedAt?: string): string | null {
  if (!RECONCILIATION_ACTIONS.includes(action) || !item.allowedActions.includes(action)) throw { status: 409, code: 'reconciliation_action_not_allowed' }
  // Commit is guarded by its complete result/usage/cost chain; the contract permits null proof.
  if (action === 'commit_confirmed_execution') return null
  const current = item.attempts.find(attempt => attempt.attemptId === item.job.currentAttemptId)
  const type = action === 'release_confirmed_non_execution' ? 'confirmed_non_execution' : 'deduplicated_replay_safe'
  const proofs = item.providerProofs.filter(proof => proof.proofType === type && current &&
    proof.providerName === current.providerName && proof.providerOperationId === current.providerOperationId &&
    proof.providerRequestId === current.providerRequestId &&
    (action !== 'authorize_safe_reexecution' || proof.validityMode === 'unbounded_key_lifetime') &&
    (['terminal_fact', 'unbounded_key_lifetime'].includes(proof.validityMode) ||
      (proof.validityMode === 'expires_at' && proof.validUntil && Date.parse(proof.validUntil) > Date.parse(evaluatedAt ?? new Date().toISOString()))))
  const proof = proofs[proofs.length - 1]
  if (!proof) throw { status: 409, code: 'reconciliation_provider_proof_required' }
  return proof.providerProofId
}
export function validateResolutionCommand(body: string): ResolutionCommand {
  try {
  const value = JSON.parse(body) as ResolutionCommand
  const names = ['operationId', 'clientId', 'findingId', 'jobId', 'reservationId', 'action', 'reason', 'expectedCaseVersion', 'evidenceFingerprint', 'providerProofId']
  const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  if (!value || typeof value !== 'object' || Object.keys(value).length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(value, name)) ||
    !uuid7.test(value.operationId) || !uuid7.test(value.findingId) ||
    ![value.clientId, value.jobId, value.reservationId].every(id => typeof id === 'string' && isReconciliationClient(id)) ||
    !RECONCILIATION_ACTIONS.includes(value.action) || typeof value.reason !== 'string' || normalizeReconciliationReason(value.reason) !== value.reason ||
    typeof value.expectedCaseVersion !== 'string' || !value.expectedCaseVersion.trim() || !/^[0-9a-f]{64}$/.test(value.evidenceFingerprint) ||
    (value.providerProofId !== null && !uuid7.test(value.providerProofId)) || (value.action !== 'commit_confirmed_execution' && value.providerProofId === null)) throw new ReconciliationContractError()
  return value
  } catch { throw new ReconciliationCommandError() }
}
export async function resolveReconciliation(body: string, signal?: AbortSignal): Promise<ReconciliationResolution> {
  const command = validateResolutionCommand(body)
  const response = await apiClient.postApiRoot<unknown>('/api/billing/reconciliation/resolutions', body, { signal, retryOnUnauthorized: false })
  if (response.status !== 200 || !validateReconciliationResolution(response.data) || response.data.operationId !== command.operationId || response.data.findingId !== command.findingId || response.data.action !== command.action || response.data.applied === response.data.replayed) throw new ReconciliationContractError()
  const expected = {
    commit_confirmed_execution: ['completed', 'committed'],
    release_confirmed_non_execution: ['failed', 'released'],
    authorize_safe_reexecution: ['reserved', 'active'],
  }[command.action]
  if (response.data.afterState.jobStatus !== expected[0] || response.data.afterState.reservationState !== expected[1] || response.data.afterState.evidenceFingerprint !== command.evidenceFingerprint) throw new ReconciliationContractError()
  return response.data
}
export type ReconciliationOutcome = 'denied' | 'stale' | 'error' | 'unknown'
export function reconciliationOutcome(error: unknown): ReconciliationOutcome {
  const status = (error as { status?: number } | null)?.status
  if (status === 401 || status === 403) return 'denied'
  if (status === 409 || status === 404) return 'stale'
  if (status === 400 || status === 413 || status === 415) return 'error'
  return 'unknown'
}
