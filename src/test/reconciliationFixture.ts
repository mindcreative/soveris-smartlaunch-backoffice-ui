import type { ReconciliationPage } from '../types/reconciliation'
export const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
export const FINDING = '01995d88-7740-73f1-8000-000000000001'
export const JOB = '01995d88-7740-73f1-8000-000000000002'
export const RESERVATION = '01995d88-7740-73f1-8000-000000000003'
export const PROOF = '01995d88-7740-73f1-8000-000000000004'
const at = '2026-10-05T08:00:00Z'
export function reconciliationFixture(): ReconciliationPage {
  return { schemaVersion: 1, clientId: CLIENT, asOf: at, evaluatedAt: at, nextCursor: null, items: [{
    finding: { findingId: FINDING, evidenceVersion: 2, findingType: 'execution_unknown', cause: 'Provider outcome uncertain', severity: 'critical', detectedAt: at, resolvedAt: null, ageSeconds: 3600, resolutionStatus: 'open', resolutionSource: 'none', anchorType: 'job', anchorId: JOB },
    job: { jobId: JOB, clientId: CLIENT, reservationId: RESERVATION, requestType: 'image_generation', status: 'execution_unknown', acceptedParametersHash: 'a'.repeat(64), attemptCount: 1, currentAttemptId: FINDING, createdAt: at, updatedAt: at, processingStartedAt: at, processingLeaseExpiresAt: at, completedAt: null },
    reservation: { reservationId: RESERVATION, accountId: CLIENT, jobId: JOB, estimatedCredits: '2.2500', actualCredits: null, state: 'active', createdAt: at, expiresAt: '2026-10-06T08:00:00Z', committedAt: null, releasedAt: null },
    attempts: [{ attemptId: FINDING, attemptNumber: 1, messageEventId: null, actorType: 'worker', actorUserId: null, outcomeStatus: 'execution_unknown', executionPhase: 'dispatched', providerName: 'fixture', providerOperationId: 'provider-op', providerRequestId: 'provider-request', timingStartedAt: at, timingCompletedAt: at, failureCategory: 'unknown_outcome', retryDisposition: null }], result: null, usage: null, providerCosts: [], correlation: { correlationId: 'fixture-correlation', operationIds: [], messageEventIds: [], outboxEventIds: [], ledgerOperationIds: [] },
    evidence: [{ evidenceVersion: 2, role: 'case_fact', kind: 'job', evidenceKey: 'job:fixture', identityDisposition: 'canonical', identityId: JOB, source: 'finding_v2' }],
    providerProofs: [{ providerProofId: PROOF, proofType: 'confirmed_non_execution', providerName: 'fixture', providerOperationId: 'provider-op', providerRequestId: 'provider-request', verificationSource: 'provider_billing_api', verifiedAt: at, validityMode: 'terminal_fact', validUntil: null, guaranteeName: null, guaranteeVersion: null, deduplicationBehavior: null, recordHash: 'b'.repeat(64) }],
    operatorResolution: null, caseVersion: 'opaque-case-version', evidenceFingerprint: 'c'.repeat(64), evidenceKeys: ['job:fixture'], allowedActions: ['release_confirmed_non_execution'], actionBlockers: []
  }] }
}
