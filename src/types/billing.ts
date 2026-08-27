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
