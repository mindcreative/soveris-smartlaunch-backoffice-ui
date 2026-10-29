// Pure delivered schemas; compiled by the build, never with browser eval.
export const RECONCILIATION_ACTIONS = ['commit_confirmed_execution', 'release_confirmed_non_execution', 'authorize_safe_reexecution'] as const
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
export const ReconciliationResolutionSchema = object({
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
export const ReconciliationPageSchema = object({
  schemaVersion: { const: 1 },
  clientId: uuid,
  asOf: timestamp,
  evaluatedAt: timestamp,
  items: array(ReconciliationCaseSchema),
  nextCursor: nullable(string),
})
