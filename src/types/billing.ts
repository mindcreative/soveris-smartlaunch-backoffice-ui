import type { LocalInstantValue } from '../timezone/LocalInstant'

export type BillingAccountStatus = 'active' | 'suspended' | 'closed'

export interface BillingAccountSnapshot {
  creditAccountId: string
  clientId: string
  ownedBalance: string
  activelyReservedAmount: string
  availableBalance: string
  activeReservationCount: number
  status: BillingAccountStatus
  asOf: LocalInstantValue
  walletVersion: string
}

export interface BillingEntitlementsV1 {
  schemaVersion: 1
  rateLimits: {
    requestsPerMinute: number
    concurrentAiOperations: number
  }
  featureFlags: {
    contentGeneration: boolean
    imageGeneration: boolean
  }
}

export type BillingSubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired'
export type BillingSubscriptionTier = 'freemium' | 'basic' | 'brand' | 'brand_premium'
export type BillingSubscriptionChangePolicy = 'immediate' | 'next_billing_cycle'
export type BillingSubscriptionProrationPolicy = 'none' | 'replace' | 'prorate'
export type BillingSubscriptionGrantType = 'billing_cycle' | 'operator_override'

export interface BillingSubscriptionUnsupportedView {
  status: 'unsupported'
}

export interface BillingSubscriptionPendingChange {
  schemaVersion: number
  planChangeOperationId: string
  planName: string
  cycleCreditAmount: string
  entitlements: BillingEntitlementsV1
  changeEffectivePolicy: BillingSubscriptionChangePolicy
  prorationPolicy: BillingSubscriptionProrationPolicy
  unusedCreditPolicy: 'rollover'
  effectiveCycleIndex: number
  effectiveCycleStart: string
  effectiveCycleEnd: string
  scheduledAt: string
}

export interface BillingSubscriptionPendingTierChange {
  schemaVersion: 1
  operationId: string
  subscriptionTier: BillingSubscriptionTier
  expectedTierRevision: string
  effectivePolicy: 'next_billing_cycle'
  effectiveCycleIndex: number
  effectiveCycleStart: string
  effectiveCycleEnd: string
  scheduledAt: string
  reason: string
}

export interface BillingSubscriptionImmediateDebit {
  planChangeOperationId: string
  outstandingDebit: string
  policyVersion: string
  originalDebit: string
  appliedDebit: string
  createdAt: string
  lastAppliedAt?: string
  lastAppliedCycleIndex?: number
  lastAppliedCycleStart?: string
}

export interface BillingSubscriptionImmediateContext {
  cycleIndex: number
  cycleStart: string
  cycleEnd: string
  grantOperationId?: string
}

export interface BillingSubscriptionItem {
  subscriptionId: string
  creationOperationId: string
  planTermsOperationId: string
  clientId: string
  planName: string
  subscriptionTier: BillingSubscriptionTier
  tierRevision: string
  cycleCreditAmount: string
  entitlements: BillingEntitlementsV1
  changeEffectivePolicy: BillingSubscriptionChangePolicy
  prorationPolicy: BillingSubscriptionProrationPolicy
  unusedCreditPolicy: 'rollover'
  billingCycleAnchor: string
  status: BillingSubscriptionStatus
  validFrom: string
  validTo: string | null
  createdAt: string
  updatedAt: string
  pendingImmediateDebit?: BillingSubscriptionImmediateDebit | BillingSubscriptionUnsupportedView
  immediateChangeContext?: BillingSubscriptionImmediateContext | BillingSubscriptionUnsupportedView
}

export interface BillingSubscriptionGrant {
  grantId: string
  grantOperationId: string
  subscriptionId: string
  planTermsOperationId: string
  planNameSnapshot: string
  subscriptionTierSnapshot: BillingSubscriptionTier
  tierRevisionSnapshot: string
  entitlementsSnapshot: BillingEntitlementsV1
  grantType: BillingSubscriptionGrantType
  cycleStart: string
  cycleEnd: string
  creditAmount: string
  ledgerEntryId: string
  createdAt: string
}

export interface BillingSubscriptionGrantHistory {
  items: BillingSubscriptionGrant[]
  historyAsOf: string
  nextCursor: string | null
}

export interface BillingSubscriptionState {
  clientId: string
  stateAsOf: string
  current: BillingSubscriptionItem | null
  pendingChange: BillingSubscriptionPendingChange | BillingSubscriptionUnsupportedView | null
  subscriptionHistory: BillingSubscriptionItem[]
  grantHistory: BillingSubscriptionGrantHistory
  pendingImmediateDebit?: BillingSubscriptionImmediateDebit | BillingSubscriptionUnsupportedView
  immediateChangeContext?: BillingSubscriptionImmediateContext | BillingSubscriptionUnsupportedView
  pendingTierChange?: BillingSubscriptionPendingTierChange
}

export const CLIENT_CAPABILITY_KEYS = [
  'manual_content_editing',
  'ordinary_image_upload',
  'ai_content_generation',
  'ai_image_generation',
  'ai_source_ingestion',
  'client_domain_binding',
  'product_domain_binding',
  'analytics',
  'ab_testing',
] as const

export type ClientCapabilityKey = typeof CLIENT_CAPABILITY_KEYS[number]
export type ClientClassification = 'customer' | 'soveris_internal'
export type ClientCapabilityPolicySource =
  | 'internal'
  | 'customer_subscription'
  | 'customer_freemium'
export type ClientCapabilityLimitKey =
  | 'active_products'
  | 'hostnames'
  | 'storage_bytes'
  | 'requests_per_minute'
  | 'concurrent_ai_operations'
  | 'retention_days'
export type ClientCapabilityLimitUnit = 'count' | 'bytes' | 'requests_per_minute' | 'days'
export type ClientCapabilityEvidenceStatus =
  | 'satisfied'
  | 'denied'
  | 'unavailable'
  | 'not_applicable'
export type ClientCapabilityFundingEvidence =
  | 'not_applicable'
  | 'wallet_missing'
  | 'wallet_ineligible'
  | 'zero_available'
  | 'available_requires_quote'
  | 'sufficient_for_quote'
  | 'insufficient_credits'
  | 'unavailable'
export type ClientCapabilityDenialCondition =
  | 'permission_denied'
  | 'client_inactive'
  | 'feature_not_available'
  | 'entitlement_not_available'
  | 'limit_reached'
  | 'provider_unavailable'
  | 'pricing_unavailable'
  | 'wallet_missing'
  | 'wallet_ineligible'
  | 'insufficient_credits'
  | 'configuration_unavailable'
  | 'dependency_unavailable'
  | 'transition_pending'
  | 'stale_capability_evidence'

export interface ClientCapabilitySubscription {
  storedTier: BillingSubscriptionTier
  effectiveTier: BillingSubscriptionTier | null
  status: BillingSubscriptionStatus
  tierRevision: string
  validFrom: string
  validTo: string | null
}

export interface ClientCapabilityFlag {
  key: ClientCapabilityKey
  enabled: boolean
}

export interface ClientCapabilityLimit {
  key: ClientCapabilityLimitKey
  unit: ClientCapabilityLimitUnit
  value: string
}

export interface ClientCapabilityUsage extends ClientCapabilityLimit {
  measuredAt: string
}

export interface ClientCapabilityOperation {
  key: ClientCapabilityKey
  outcome: 'eligible' | 'denied'
  permission: ClientCapabilityEvidenceStatus
  feature: ClientCapabilityEvidenceStatus
  entitlement: ClientCapabilityEvidenceStatus
  resourceLimit: ClientCapabilityEvidenceStatus
  provider: ClientCapabilityEvidenceStatus
  pricing: ClientCapabilityEvidenceStatus
  funding: ClientCapabilityFundingEvidence
  denialConditions: ClientCapabilityDenialCondition[]
}

export interface ClientCapabilities {
  clientId: string
  classificationSource: 'back_office.clients'
  classification: ClientClassification
  classificationRevision: string
  policySource: ClientCapabilityPolicySource
  policyVersion: string
  subscription: ClientCapabilitySubscription | null
  flags: ClientCapabilityFlag[]
  limits: ClientCapabilityLimit[]
  usage: ClientCapabilityUsage[]
  operations: ClientCapabilityOperation[]
  evaluatedAt: string
  nextBoundary: string | null
}

export type BillingSubscriptionPageRequest =
  | { pageSize?: number; cursor?: never }
  | { cursor: string; pageSize?: never }

export interface CreateBillingSubscriptionRequest {
  creationOperationId: string
  planName: string
  subscriptionTier: BillingSubscriptionTier
  cycleCreditAmount: string
  validFrom: string
  validTo: string | null
  changeEffectivePolicy: 'immediate'
  prorationPolicy: 'replace'
  unusedCreditPolicy: 'rollover'
  entitlements: BillingEntitlementsV1
}

export type CreateBillingSubscriptionMaterial = Omit<
  CreateBillingSubscriptionRequest,
  'creationOperationId'
>

export interface BillingSubscriptionCreationAttempt {
  clientId: string
  request: CreateBillingSubscriptionRequest
  serializedBody: string
}

export interface BillingSubscriptionCreationAccount {
  creditAccountId: string
  clientId: string
  ownedBalance: string
  activelyReservedAmount: string
  availableBalance: string
  status: BillingAccountStatus
  asOf: string
}

export interface BillingSubscriptionCreationReceipt {
  created: boolean
  subscription: Omit<BillingSubscriptionItem, 'createdAt' | 'updatedAt' | 'pendingImmediateDebit' | 'immediateChangeContext'>
  initialGrant: Omit<BillingSubscriptionGrant, 'subscriptionId' | 'createdAt'>
  account: BillingSubscriptionCreationAccount
}

export type BillingSubscriptionLifecycleAction = 'pause' | 'reactivate' | 'cancel' | 'expire'
export type BillingSubscriptionLifecycleSourceStatus = 'active' | 'paused'

export interface BillingSubscriptionLifecycleRequest {
  lifecycleOperationId: string
  action: BillingSubscriptionLifecycleAction
  expectedStatus: BillingSubscriptionLifecycleSourceStatus
  reason: string
}

export interface BillingSubscriptionLifecycleAttempt {
  clientId: string
  subscriptionId: string
  request: BillingSubscriptionLifecycleRequest
  serializedBody: string
  validTo: string | null
}

export interface BillingSubscriptionLifecycleReceipt {
  lifecycleOperationId: string
  clientId: string
  subscriptionId: string
  action: BillingSubscriptionLifecycleAction
  previousStatus: BillingSubscriptionLifecycleSourceStatus
  status: BillingSubscriptionStatus
  reason: string
  effectiveAt: string
  operationAsOf: string
}

export type BillingSubscriptionTierAction =
  | 'apply_immediate'
  | 'schedule'
  | 'replace'
  | 'cancel_pending'

export interface BillingSubscriptionTierChangeMaterial {
  action: BillingSubscriptionTierAction
  subscriptionTier: BillingSubscriptionTier
  expectedTierRevision: string
  effectivePolicy: BillingSubscriptionChangePolicy
  expectedPendingTierChangeOperationId?: string
  reason: string
}

export interface BillingSubscriptionTierChangeRequest {
  operationId: string
  expectedTierRevision: string
  subscriptionTier: BillingSubscriptionTier
  effectivePolicy?: BillingSubscriptionChangePolicy
  expectedPendingTierChangeOperationId?: string
  reason: string
  commandAuthorityHash: string
}

export interface BillingSubscriptionTierChangeAttempt {
  clientId: string
  subscriptionId: string
  action: BillingSubscriptionTierAction
  route: string
  request: BillingSubscriptionTierChangeRequest
  serializedBody: string
}

export type BillingSubscriptionTierChangeOutcome =
  | 'changed'
  | 'no_change'
  | 'scheduled'
  | 'replaced'
  | 'cancelled'

export interface BillingSubscriptionTierChangeReceipt {
  schemaVersion: 1
  operationId: string
  clientId: string
  subscriptionId: string
  outcome: BillingSubscriptionTierChangeOutcome
  effectivePolicy: BillingSubscriptionChangePolicy
  requestedSubscriptionTier: BillingSubscriptionTier
  previousSubscriptionTier: BillingSubscriptionTier
  resultingSubscriptionTier: BillingSubscriptionTier
  expectedTierRevision: string
  previousTierRevision: string
  resultingTierRevision: string
  reason: string
  operationAsOf: string
  effectiveAt: string
  action?: 'schedule' | 'replace' | 'cancel'
  previousPendingTierChangeOperationId?: string | null
  pendingTierChangeOperationId?: string | null
  previousPendingSubscriptionTier?: BillingSubscriptionTier | null
  pendingSubscriptionTier?: BillingSubscriptionTier | null
}

export interface BillingSubscriptionTierState {
  subscriptionTier: BillingSubscriptionTier
  tierRevision: string
  status: BillingSubscriptionStatus
  validFrom: string
  validTo: string | null
  pendingTierChange: BillingSubscriptionPendingTierChange | null
  observedAt: string
}

export interface BillingSubscriptionTierChangeResponse {
  schemaVersion: 1
  receipt: BillingSubscriptionTierChangeReceipt
  tierState: BillingSubscriptionTierState
}

export type ResourceAccessPreviewAction =
  | BillingSubscriptionTierAction
  | BillingSubscriptionLifecycleAction

export interface ResourceAccessPreviewRequest {
  action: ResourceAccessPreviewAction
  expectedStatus: BillingSubscriptionLifecycleSourceStatus
  expectedTierRevision: string
  subscriptionTier: BillingSubscriptionTier | null
  effectivePolicy: BillingSubscriptionChangePolicy | null
}

export interface ResourceAccessPreviewResource {
  resourceType: 'product' | 'domain_binding'
  resourceId: string
  disposition: 'grace' | 'suspended'
  accessUntil: string | null
  proofExpiresAt: string | null
}

export interface ResourceAccessDeadlineGroup {
  lossAt: string
  accessUntil: string
  graceCount: number
  newlyAffectedCount: number
}

export interface ResourceAccessConsequenceResource {
  resourceType: 'product' | 'domain_binding'
  resourceId: string
  state: 'eligible' | 'grace' | 'suspended'
  accessUntil: string | null
  proofExpiresAt: string | null
}

export interface ResourceAccessPreservationFacts {
  contentPreserved: true
  assetsPreserved: true
  creditsUnchanged: true
  acceptedAiWorkUnchanged: true
}

export interface ResourceAccessPreview {
  clientId: string
  subscriptionId: string
  action: ResourceAccessPreviewAction
  currentSubscriptionTier: BillingSubscriptionTier
  targetSubscriptionTier: BillingSubscriptionTier | null
  effectivePolicy: BillingSubscriptionChangePolicy | null
  statusRevision: string
  classificationRevision: string
  tierRevision: string
  pendingTierChangeOperationId: string | null
  policyPublicationId: string
  policyActivationRevision: string
  policyVersion: string
  policyHash: string
  evaluatedAt: string
  commandEffectiveAt: string | null
  commandAuthorityHash: string | null
  lossAt: string | null
  accessUntil: string | null
  earliestProofExpiry: string | null
  retainedCount: number
  totalCount: number
  graceCount: number
  suspendedCount: number
  deadlineGroups: ResourceAccessDeadlineGroup[]
  deadlineGroupsTruncated: boolean
  unlistedGraceCount: number
  unlistedNewlyAffectedCount: number
  affectedResourcesTruncated: boolean
  preservationFacts: ResourceAccessPreservationFacts
  affectedResources: ResourceAccessPreviewResource[]
}

export interface ResourceAccessConsequence {
  consequenceId: string
  projectionRunId: string
  projectionRevision: string
  causeIdentity: string
  consequenceKind: 'scheduled' | 'grace_started' | 'suspended' | 'restored' | 'cancelled'
  lossAt: string | null
  accessUntil: string | null
  earliestProofExpiry: string | null
  retainedCount: number
  totalCount: number
  graceCount: number
  suspendedCount: number
  affectedResources: ResourceAccessConsequenceResource[]
  affectedResourcesTruncated: boolean
  deadlineGroups: Array<{ accessUntil: string | null; graceCount: number }>
  deadlineGroupsTruncated: boolean
  unlistedGraceCount: number
  suspensionGroups: Array<{ accessUntil: string | null; suspendedCount: number; reason:
    'finite_limit' | 'product_inactive' | 'product_unpublished' |
    'routing_inactive' | 'ownership_unverified' | 'tls_unavailable' |
    'target_product_not_retained' | 'client_disabled' |
    'policy_unavailable' | 'hard_denial' }>
  unlistedSuspendedCount: number
  restoredCount: number | null
  restoredAt: string | null
  reminders: Array<{
    reminderKind: 'reminder_72h' | 'reminder_24h'
    dueAt: string
    recordedAt: string
    graceCount: number
    earliestProofExpiry: string | null
  }>
  preservationFacts: Record<string, boolean>
  recordedAt: string
}

export const BILLING_LEDGER_TRANSACTION_TYPES = [
  'subscription_grant',
  'reservation',
  'consumption',
  'manual_adjustment',
  'reversal',
  'promotion',
  'reservation_expired',
  'reservation_committed',
  'reservation_released',
] as const

export type BillingLedgerTransactionType = typeof BILLING_LEDGER_TRANSACTION_TYPES[number]

export interface BillingLedgerFilters {
  creditAccountId?: string
  from?: string
  to?: string
  transactionType?: BillingLedgerTransactionType
  actorUserId?: string
  jobId?: string
  reservationId?: string
  pageSize?: number
}

export interface BillingLedgerItem {
  ledgerId: string
  creditAccountId: string
  jobId: string | null
  reservationId: string | null
  adjustmentId: string | null
  operationId: string
  transactionType: BillingLedgerTransactionType
  amount: string
  balanceAfter: string
  ruleId: string | null
  ruleVersion: string | null
  actorUserId: string | null
  reason: string | null
  createdAt: LocalInstantValue
}

export interface BillingLedgerPage {
  items: BillingLedgerItem[]
  asOf: LocalInstantValue
  nextCursor: string | null
}

export type BillingLedgerPageRequest =
  | { filters: BillingLedgerFilters; cursor?: never }
  | { cursor: string; filters?: never }

export type BillingLedgerExportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired'

export type BillingLedgerExportFailureCode =
  | 'generation_failed'
  | 'artifact_store_failed'
  | 'completion_failed'

export interface BillingLedgerExportFilters {
  creditAccountId: string | null
  from: string | null
  to: string | null
  transactionType: BillingLedgerTransactionType | null
  actorUserId: string | null
  jobId: string | null
  reservationId: string | null
}

export interface BillingLedgerExportAttempt {
  exportId: string
  clientId: string
  filters: BillingLedgerExportFilters
  requestedAt: string
  asOf: string
}

export interface BillingLedgerExportAccepted extends BillingLedgerExportAttempt {
  status: 'pending'
}

export interface BillingLedgerExportStatusMetadata extends BillingLedgerExportAttempt {
  status: BillingLedgerExportStatus
  rowCount: string | null
  byteSize: string | null
  artifactExpiresAt: string | null
  failureCode: BillingLedgerExportFailureCode | null
}

export interface BillingLedgerExportReference {
  value: string
  expiresAt: string
}

export interface BillingLedgerExportStatusResult {
  metadata: BillingLedgerExportStatusMetadata
  reference: BillingLedgerExportReference | null
}
