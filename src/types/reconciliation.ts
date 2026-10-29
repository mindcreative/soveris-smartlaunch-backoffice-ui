// Closed wire projections from the delivered Story 5.14 contract. Decimal evidence stays textual.
import { RECONCILIATION_ACTIONS } from '../contracts/reconciliation/schema'
export { RECONCILIATION_ACTIONS } from '../contracts/reconciliation/schema'
export { validateReconciliationPage, validateReconciliationResolution } from '@/contracts/reconciliation/generated/validators.cjs'
export type ReconciliationAction = typeof RECONCILIATION_ACTIONS[number]

export interface ReconciliationPage {
  schemaVersion: number
  clientId: string
  asOf: string
  evaluatedAt: string
  items: ReconciliationCase[]
  nextCursor: string | null
}
export interface ReconciliationResolution {
  schemaVersion: number
  operationId: string
  findingId: string
  action: ReconciliationAction
  applied: boolean
  replayed: boolean
  resolvedAt: string
  afterState: AfterState
  caseVersion: string
}
export interface ReconciliationCase {
  finding: ReconciliationFinding
  job: ReconciliationJob
  reservation: ReconciliationReservation
  attempts: ReconciliationAttempt[]
  result: ReconciliationResult | null
  usage: ReconciliationUsage | null
  providerCosts: ReconciliationProviderCost[]
  correlation: ReconciliationCorrelation
  evidence: ReconciliationEvidence[]
  providerProofs: ReconciliationProviderProof[]
  operatorResolution: ReconciliationOperatorResolution | null
  caseVersion: string
  evidenceFingerprint: string
  evidenceKeys: string[]
  allowedActions: string[]
  actionBlockers: string[]
}
export interface ReconciliationFinding {
  findingId: string
  evidenceVersion: number
  findingType: string
  cause: string
  severity: string
  detectedAt: string
  resolvedAt: string | null
  ageSeconds: number
  resolutionStatus: string
  resolutionSource: string
  anchorType: string
  anchorId: string
}
export interface ReconciliationJob {
  jobId: string | null
  clientId: string
  reservationId: string | null
  requestType: string | null
  status: string | null
  acceptedParametersHash: string | null
  attemptCount: number | null
  currentAttemptId: string | null
  createdAt: string | null
  updatedAt: string | null
  processingStartedAt: string | null
  processingLeaseExpiresAt: string | null
  completedAt: string | null
}
export interface ReconciliationReservation {
  reservationId: string | null
  accountId: string | null
  jobId: string | null
  estimatedCredits: string | null
  actualCredits: string | null
  state: string | null
  createdAt: string | null
  expiresAt: string | null
  committedAt: string | null
  releasedAt: string | null
}
export interface ReconciliationAttempt {
  attemptId: string
  attemptNumber: number
  messageEventId: string | null
  actorType: string
  actorUserId: string | null
  outcomeStatus: string
  executionPhase: string
  providerName: string | null
  providerOperationId: string | null
  providerRequestId: string | null
  timingStartedAt: string
  timingCompletedAt: string | null
  failureCategory: string | null
  retryDisposition: string | null
}
export interface ReconciliationResult {
  resultId: string
  jobId: string
  attemptId: string
  resultKind: string
  variationCount: number
  privateOutputPresent: boolean
  mimeType: string | null
  fileSizeBytes: number | null
  executionDurationMs: number | null
  providerName: string
  modelName: string
  providerOperationId: string | null
  providerRequestId: string | null
  finishReason: string | null
  observedAt: string
  createdAt: string
}
export interface ReconciliationUsage {
  usageId: string
  jobId: string
  attemptId: string
  reservationId: string
  clientId: string
  accountId: string
  providerName: string
  modelName: string
  inputTokens: number | null
  outputTokens: number | null
  imageCount: number
  chargedCredits: string
  correlationId: string
  observedAt: string
  createdAt: string
}
export interface ReconciliationProviderCost {
  costId: string
  jobId: string
  attemptId: string
  usageId: string | null
  providerName: string
  modelName: string
  providerOperationId: string | null
  providerRequestId: string | null
  estimatedAmount: string | null
  estimatedSource: string | null
  actualAmount: string | null
  actualSource: string | null
  costStatus: string
  currency: string | null
  invoiceReferenceHash: string | null
  capturedAt: string
  reconciledAt: string | null
}
export interface ReconciliationCorrelation {
  correlationId: string | null
  operationIds: string[]
  messageEventIds: string[]
  outboxEventIds: string[]
  ledgerOperationIds: string[]
}
export interface ReconciliationEvidence {
  evidenceVersion: number
  role: string
  kind: string
  evidenceKey: string
  identityDisposition: string
  identityId: string
  source: string
}
export interface ReconciliationProviderProof {
  providerProofId: string
  proofType: string
  providerName: string
  providerOperationId: string | null
  providerRequestId: string | null
  verificationSource: string
  verifiedAt: string
  validityMode: string
  validUntil: string | null
  guaranteeName: string | null
  guaranteeVersion: string | null
  deduplicationBehavior: string | null
  recordHash: string
}
export interface ReconciliationOperatorResolution {
  operationId: string
  action: ReconciliationAction
  actorUserId: string
  actorClientId: string
  actorRole: string
  adminBypass: boolean
  reason: string
  resolvedAt: string
  beforeStateHash: string
  afterStateHash: string
  providerProofId: string | null
  resolutionEvidenceKeys: string[]
}
export interface AfterState {
  schemaVersion: number
  evidenceFingerprint: string
  jobStatus: string
  attemptOutcomeStatus: string
  attemptExecutionPhase: string
  leaseState: string
  reservationState: string
  attemptCount: number
  currentAttemptId: string | null
  estimatedCredits: string
  actualCredits: string | null
  resultIds: string[]
  usageIds: string[]
  providerCostIds: string[]
  ledgerOperationIds: string[]
  outcomeEventIds: string[]
  outboxEventIds: string[]
}
