// Closed wire projections from the delivered Story 5.14 contract. Decimal evidence stays textual.
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
export const RECONCILIATION_ACTIONS = ['commit_confirmed_execution', 'release_confirmed_non_execution', 'authorize_safe_reexecution'] as const
export type ReconciliationAction = typeof RECONCILIATION_ACTIONS[number]
type Schema = Record<string, unknown>
const string = { type: 'string', minLength: 1 }
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', not: { const: '00000000-0000-0000-0000-000000000000' } }
const uuid7 = { ...uuid, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }
const timestamp = { type: 'string', format: 'date-time' }
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const boolean = { type: 'boolean' }
const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,13})\\.[0-9]{4}$' }
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' }
const action = { enum: RECONCILIATION_ACTIONS }
const array = (items: Schema) => ({ type: 'array', items })
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: 'null' }] })
const object = (properties: Record<string, Schema>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
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
const afterState = object({
  schemaVersion: { const: 1 },
  evidenceFingerprint: hash,
  jobStatus: string,
  attemptOutcomeStatus: string,
  attemptExecutionPhase: string,
  leaseState: string,
  reservationState: string,
  attemptCount: integer,
  currentAttemptId: nullable(uuid),
  estimatedCredits: decimal,
  actualCredits: nullable(decimal),
  resultIds: array(uuid),
  usageIds: array(uuid),
  providerCostIds: array(uuid),
  ledgerOperationIds: array(uuid),
  outcomeEventIds: array(uuid),
  outboxEventIds: array(uuid),
})
const ReconciliationResolutionSchema = object({
  schemaVersion: { const: 1 },
  operationId: uuid7,
  findingId: uuid7,
  action: action,
  applied: boolean,
  replayed: boolean,
  resolvedAt: timestamp,
  afterState: afterState,
  caseVersion: string,
})
const ReconciliationFindingSchema = object({
  findingId: uuid7,
  evidenceVersion: integer,
  findingType: string,
  cause: string,
  severity: string,
  detectedAt: timestamp,
  resolvedAt: nullable(timestamp),
  ageSeconds: integer,
  resolutionStatus: string,
  resolutionSource: string,
  anchorType: string,
  anchorId: uuid,
})
const ReconciliationJobSchema = object({
  jobId: nullable(uuid),
  clientId: uuid,
  reservationId: nullable(uuid),
  requestType: nullable(string),
  status: nullable(string),
  acceptedParametersHash: nullable(hash),
  attemptCount: nullable(integer),
  currentAttemptId: nullable(uuid),
  createdAt: nullable(timestamp),
  updatedAt: nullable(timestamp),
  processingStartedAt: nullable(timestamp),
  processingLeaseExpiresAt: nullable(timestamp),
  completedAt: nullable(timestamp),
})
const ReconciliationReservationSchema = object({
  reservationId: nullable(uuid),
  accountId: nullable(uuid),
  jobId: nullable(uuid),
  estimatedCredits: nullable(decimal),
  actualCredits: nullable(decimal),
  state: nullable(string),
  createdAt: nullable(timestamp),
  expiresAt: nullable(timestamp),
  committedAt: nullable(timestamp),
  releasedAt: nullable(timestamp),
})
const ReconciliationAttemptSchema = object({
  attemptId: uuid,
  attemptNumber: integer,
  messageEventId: nullable(uuid),
  actorType: string,
  actorUserId: nullable(uuid),
  outcomeStatus: string,
  executionPhase: string,
  providerName: nullable(string),
  providerOperationId: nullable(string),
  providerRequestId: nullable(string),
  timingStartedAt: timestamp,
  timingCompletedAt: nullable(timestamp),
  failureCategory: nullable(string),
  retryDisposition: nullable(string),
})
const ReconciliationResultSchema = object({
  resultId: uuid,
  jobId: uuid,
  attemptId: uuid,
  resultKind: string,
  variationCount: integer,
  privateOutputPresent: boolean,
  mimeType: nullable(string),
  fileSizeBytes: nullable(integer),
  executionDurationMs: nullable(integer),
  providerName: string,
  modelName: string,
  providerOperationId: nullable(string),
  providerRequestId: nullable(string),
  finishReason: nullable(string),
  observedAt: timestamp,
  createdAt: timestamp,
})
const ReconciliationUsageSchema = object({
  usageId: uuid,
  jobId: uuid,
  attemptId: uuid,
  reservationId: uuid,
  clientId: uuid,
  accountId: uuid,
  providerName: string,
  modelName: string,
  inputTokens: nullable(integer),
  outputTokens: nullable(integer),
  imageCount: integer,
  chargedCredits: decimal,
  correlationId: string,
  observedAt: timestamp,
  createdAt: timestamp,
})
const ReconciliationProviderCostSchema = object({
  costId: uuid,
  jobId: uuid,
  attemptId: uuid,
  usageId: nullable(uuid),
  providerName: string,
  modelName: string,
  providerOperationId: nullable(string),
  providerRequestId: nullable(string),
  estimatedAmount: nullable(decimal),
  estimatedSource: nullable(string),
  actualAmount: nullable(decimal),
  actualSource: nullable(string),
  costStatus: string,
  currency: nullable(string),
  invoiceReferenceHash: nullable(string),
  capturedAt: timestamp,
  reconciledAt: nullable(timestamp),
})
const ReconciliationCorrelationSchema = object({
  correlationId: nullable(string),
  operationIds: array(uuid),
  messageEventIds: array(uuid),
  outboxEventIds: array(uuid),
  ledgerOperationIds: array(uuid),
})
const ReconciliationEvidenceSchema = object({
  evidenceVersion: integer,
  role: string,
  kind: string,
  evidenceKey: string,
  identityDisposition: string,
  identityId: uuid,
  source: string,
})
const ReconciliationProviderProofSchema = object({
  providerProofId: uuid7,
  proofType: string,
  providerName: string,
  providerOperationId: nullable(string),
  providerRequestId: nullable(string),
  verificationSource: string,
  verifiedAt: timestamp,
  validityMode: string,
  validUntil: nullable(timestamp),
  guaranteeName: nullable(string),
  guaranteeVersion: nullable(string),
  deduplicationBehavior: nullable(string),
  recordHash: hash,
})
const ReconciliationOperatorResolutionSchema = object({
  operationId: uuid7,
  action: action,
  actorUserId: uuid,
  actorClientId: uuid,
  actorRole: string,
  adminBypass: boolean,
  reason: string,
  resolvedAt: timestamp,
  beforeStateHash: hash,
  afterStateHash: hash,
  providerProofId: nullable(uuid7),
  resolutionEvidenceKeys: array(string),
})
const ReconciliationCaseSchema = object({
  finding: ReconciliationFindingSchema,
  job: ReconciliationJobSchema,
  reservation: ReconciliationReservationSchema,
  attempts: array(ReconciliationAttemptSchema),
  result: nullable(ReconciliationResultSchema),
  usage: nullable(ReconciliationUsageSchema),
  providerCosts: array(ReconciliationProviderCostSchema),
  correlation: ReconciliationCorrelationSchema,
  evidence: array(ReconciliationEvidenceSchema),
  providerProofs: array(ReconciliationProviderProofSchema),
  operatorResolution: nullable(ReconciliationOperatorResolutionSchema),
  caseVersion: string,
  evidenceFingerprint: hash,
  evidenceKeys: array(string),
  allowedActions: array(action),
  actionBlockers: array(string),
})
const ReconciliationPageSchema = object({
  schemaVersion: { const: 1 },
  clientId: uuid,
  asOf: timestamp,
  evaluatedAt: timestamp,
  items: array(ReconciliationCaseSchema),
  nextCursor: nullable(string),
})
const ajv = new Ajv({ strict: true })
addFormats(ajv)
export const validateReconciliationPage = ajv.compile<ReconciliationPage>(ReconciliationPageSchema)
export const validateReconciliationResolution = ajv.compile<ReconciliationResolution>(ReconciliationResolutionSchema)
