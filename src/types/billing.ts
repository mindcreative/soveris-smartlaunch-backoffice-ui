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

export interface CreditAdjustmentMaterial {
  amount: string
  reason: string
}

export interface CreditAdjustmentCommandRequest extends CreditAdjustmentMaterial {
  operationId: string
  expectedWalletVersion: string
}

export type CreditAdjustmentIneligibilityCode =
  | 'insufficient_available_credits'
  | 'projected_balance_out_of_range'

export interface CreditAdjustmentPreview extends CreditAdjustmentMaterial {
  schemaVersion: 1
  clientId: string
  creditAccountId: string
  walletVersion: string
  asOf: string
  currentOwnedBalance: string
  currentReservedBalance: string
  currentAvailableBalance: string
  projectedOwnedBalance: string
  projectedReservedBalance: string
  projectedAvailableBalance: string
  maximumSafeDebit: string
  minimumAllowedAmount: string
  walletInvariantEligible: boolean
  ineligibilityCode: CreditAdjustmentIneligibilityCode | null
}

export interface CreditAdjustmentReceipt {
  schemaVersion: 1
  operationId: string
  adjustmentId: string
  ledgerId: string
  clientId: string
  creditAccountId: string
  amount: string
  reason: string
  performedBy: string
  walletVersionBefore: string
  walletVersionAfter: string
  beforeOwnedBalance: string
  beforeReservedBalance: string
  beforeAvailableBalance: string
  afterOwnedBalance: string
  afterReservedBalance: string
  afterAvailableBalance: string
  operationAsOf: string
}

export interface CreditAdjustmentReversalRequest {
  operationId: string
  expectedWalletVersion: string
  reason: string
}

export interface CreditAdjustmentReversalReceipt {
  schemaVersion: 1
  operationId: string
  originalAdjustmentId: string
  reversalAdjustmentId: string
  reversalLedgerId: string
  clientId: string
  creditAccountId: string
  compensatingAmount: string
  reason: string
  performedBy: string
  walletVersionBefore: string
  walletVersionAfter: string
  beforeOwnedBalance: string
  beforeReservedBalance: string
  beforeAvailableBalance: string
  afterOwnedBalance: string
  afterReservedBalance: string
  afterAvailableBalance: string
  operationAsOf: LocalInstantValue
}

export interface CreditAdjustmentHistoryItemBase {
  schemaVersion: 1
  clientId: string
  creditAccountId: string
  operationId: string
  adjustmentId: string
  ledgerId: string
  amount: string
  reason: string
  performedBy: string
  expectedWalletVersion: string
  walletVersionBefore: string
  walletVersionAfter: string
  beforeOwnedBalance: string
  beforeReservedBalance: string
  beforeAvailableBalance: string
  afterOwnedBalance: string
  afterReservedBalance: string
  afterAvailableBalance: string
  operationAsOf: LocalInstantValue
}

export interface CreditAdjustmentHistoryOriginalItem extends CreditAdjustmentHistoryItemBase {
  operationType: 'original'
  originalAdjustmentId: null
  reversalAdjustmentId: string | null
}

export interface CreditAdjustmentHistoryReversalItem extends CreditAdjustmentHistoryItemBase {
  operationType: 'reversal'
  originalAdjustmentId: string
  reversalAdjustmentId: null
}

export type CreditAdjustmentHistoryItem =
  | CreditAdjustmentHistoryOriginalItem
  | CreditAdjustmentHistoryReversalItem

export interface CreditAdjustmentFamily {
  original: CreditAdjustmentHistoryOriginalItem
  reversal: CreditAdjustmentHistoryReversalItem | null
  asOf: LocalInstantValue
}

export interface CreditAdjustmentReversalReconciliationPage {
  items: CreditAdjustmentHistoryReversalItem[]
  asOf: LocalInstantValue
  nextCursor: null
}

export type CreditAdjustmentReversalIneligibilityCode =
  | 'credit_account_inactive'
  | 'credit_account_version_exhausted'
  | 'credit_adjustment_reversal_insufficient_available_credits'
  | 'credit_balance_overflow'

export interface CreditAdjustmentReversalProjection {
  inverseAmount: string
  currentOwnedBalance: string
  currentReservedBalance: string
  currentAvailableBalance: string
  projectedOwnedBalance: string
  projectedReservedBalance: string
  projectedAvailableBalance: string
  expectedWalletVersion: string
  advisoryEligible: boolean
  ineligibilityCode: CreditAdjustmentReversalIneligibilityCode | null
}

export interface CreditAdjustmentReversalAttempt {
  actorUserId: string
  clientId: string
  originalAdjustmentId: string
  creditAccountId: string
  route: string
  operationId: string
  request: CreditAdjustmentReversalRequest
  serializedBody: string
  semanticFingerprint: string
  dispatchedAt: string
  account: BillingAccountSnapshot
  original: CreditAdjustmentHistoryOriginalItem
}

export type CreditAdjustmentReversalErrorDisposition =
  | 'invalid_request'
  | 'session_lost'
  | 'permission_lost'
  | 'original_not_found'
  | 'already_reversed'
  | 'stale_wallet_version'
  | 'insufficient_available_credits'
  | 'balance_overflow'
  | 'account_inactive'
  | 'version_exhausted'
  | 'invalid_original'
  | 'operation_conflict'
  | 'contract_defect'
  | 'time_zone_not_set'
  | 'dependency_unavailable'
  | 'ambiguous'

export type CreditAdjustmentReversalPhase =
  | 'idle'
  | 'opening'
  | 'review'
  | 'revalidating'
  | 'submitting'
  | 'reconciling'
  | 'success'
  | 'rejected'
  | 'unknown'

export interface CreditAdjustmentHistoryPage {
  items: CreditAdjustmentHistoryItem[]
  asOf: LocalInstantValue
  nextCursor: string | null
}

export interface CreditAdjustmentReconciliationPage extends CreditAdjustmentHistoryPage {
  items: CreditAdjustmentHistoryOriginalItem[]
  nextCursor: null
}

export interface CreditAdjustmentHistoryFilters {
  from?: LocalInstantValue
  to?: LocalInstantValue
  actorUserId?: string
  reason?: string
  operationId?: string
  originalAdjustmentId?: string
  reversalAdjustmentId?: string
  operationType?: 'original' | 'reversal'
  pageSize?: string
}

export type CreditAdjustmentHistoryRequest =
  | { filters: CreditAdjustmentHistoryFilters }
  | { cursor: string }

export interface CreditAdjustmentAttempt {
  actorUserId: string
  clientId: string
  creditAccountId: string
  route: string
  operationId: string
  request: CreditAdjustmentCommandRequest
  serializedBody: string
  semanticFingerprint: string
  dispatchedAt: string
}

export type CreditAdjustmentPhase =
  | 'editing'
  | 'previewing'
  | 'review'
  | 'revalidating'
  | 'submitting'
  | 'unknown'
  | 'reconciling'
  | 'success'
  | 'rejected'

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

export type BillingSubscriptionPlanChangeAction =
  | 'schedule'
  | 'replace'
  | 'cancel'
  | 'apply_immediate'

export interface BillingSubscriptionPlanTerms {
  planName: string
  cycleCreditAmount: string
  entitlements: BillingEntitlementsV1
  changeEffectivePolicy: BillingSubscriptionChangePolicy
  prorationPolicy: BillingSubscriptionProrationPolicy
  unusedCreditPolicy: 'rollover'
}

export type BillingSubscriptionPlanChangePreviewRequest =
  | { action: 'cancel' }
  | {
      action: Exclude<BillingSubscriptionPlanChangeAction, 'cancel'>
      planName: string
      cycleCreditAmount: string
      entitlements: BillingEntitlementsV1
      prorationPolicy: BillingSubscriptionProrationPolicy
      unusedCreditPolicy: 'rollover'
    }

export interface BillingSubscriptionPlanChangeCalculation {
  policyVersion: string
  fundingBasis: string
  cycleIndex: number
  cycleStart: string
  cycleEnd: string
  currentCycleGrantOperationId: string | null
  totalCycleMicroseconds: string
  remainingCycleMicroseconds: string
  delta: string
  appliedDelta: string
  outstandingDelta: string
}

export interface BillingSubscriptionPlanChangeAccountProjection {
  creditAccountId: string
  walletVersionBefore: string
  walletVersionAfter: string
  balanceBefore: string
  reservedBalanceBefore: string
  availableBalanceBefore: string
  balanceAfter: string
  reservedBalanceAfter: string
  availableBalanceAfter: string
}

export interface BillingSubscriptionPlanChangePreview {
  schemaVersion: 1
  action: BillingSubscriptionPlanChangeAction
  previewToken: string
  previewedAt: string
  currentTerms: BillingSubscriptionPlanTerms
  targetTerms: BillingSubscriptionPlanTerms | null
  pendingChangeBefore: BillingSubscriptionPendingChange | BillingSubscriptionUnsupportedView | null
  pendingResult: 'created' | 'replaced' | 'cancelled' | 'preserved' | 'none'
  effectiveCycle: { cycleIndex: number; cycleStart: string; cycleEnd: string } | null
  creditEffect: {
    timing: 'immediate' | 'next_billing_cycle'
    currentCycleCreditAmount: string
    targetCycleCreditAmount: string
    calculation: BillingSubscriptionPlanChangeCalculation | null
    account: BillingSubscriptionPlanChangeAccountProjection | null
  }
  pendingImmediateDebitAfter: {
    originalDebit: string
    appliedDebit: string
    outstandingDebit: string
  } | null
}

export type BillingSubscriptionPlanChangeCommandRequest =
  BillingSubscriptionPlanChangePreviewRequest & {
    planChangeOperationId: string
    previewToken: string
    reason: string
  }

export interface BillingSubscriptionPlanChangeAttempt {
  clientId: string
  subscriptionId: string
  route: string
  request: BillingSubscriptionPlanChangeCommandRequest
  serializedBody: string
  operationId: string
}

export interface BillingSubscriptionScheduledPlanChangeReceipt {
  schemaVersion: 2
  planChangeOperationId: string
  clientId: string
  subscriptionId: string
  action: 'schedule' | 'cancel'
  previousPendingChangeOperationId: string | null
  pendingChangeOperationId: string | null
  planName: string | null
  cycleCreditAmount: string | null
  entitlements: BillingEntitlementsV1 | null
  changeEffectivePolicy: 'next_billing_cycle' | null
  prorationPolicy: BillingSubscriptionProrationPolicy | null
  unusedCreditPolicy: 'rollover' | null
  effectiveCycleIndex: number | null
  effectiveCycleStart: string | null
  effectiveCycleEnd: string | null
  subscriptionTier: BillingSubscriptionTier
  tierRevision: string
  operationAsOf: string
}

export interface BillingSubscriptionImmediatePlanChangeReceipt {
  schemaVersion: 2
  planChangeOperationId: string
  clientId: string
  subscriptionId: string
  action: 'apply_immediate'
  subscriptionTier: BillingSubscriptionTier
  tierRevision: string
  previousPlanTermsOperationId: string
  planTermsOperationId: string
  preservedPendingChangeOperationId: string | null
  oldTerms: BillingSubscriptionPlanTerms
  newTerms: BillingSubscriptionPlanTerms
  calculation: BillingSubscriptionPlanChangeCalculation
  account: BillingSubscriptionPlanChangeAccountProjection
  initialEffectOperationId: string | null
  initialLedgerEntryId: string | null
  immediateRemainderOperationId: string | null
  operationAsOf: string
}

export type BillingSubscriptionPlanChangeReceipt =
  | BillingSubscriptionScheduledPlanChangeReceipt
  | BillingSubscriptionImmediatePlanChangeReceipt

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
