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
