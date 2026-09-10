export type BillingAccountStatus = 'active' | 'suspended' | 'closed'

export interface BillingAccountSnapshot {
  creditAccountId: string
  clientId: string
  ownedBalance: string
  activelyReservedAmount: string
  availableBalance: string
  activeReservationCount: number
  status: BillingAccountStatus
  asOf: string
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
}

export type BillingSubscriptionPageRequest =
  | { pageSize?: number; cursor?: never }
  | { cursor: string; pageSize?: never }

export interface CreateBillingSubscriptionRequest {
  creationOperationId: string
  planName: string
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
  createdAt: string
}

export interface BillingLedgerPage {
  items: BillingLedgerItem[]
  asOf: string
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
