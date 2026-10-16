import type { LocalInstantValue } from '../timezone/LocalInstant'
export interface DomainRecord {
  type: 'CNAME' | 'TXT' | 'ALIAS' | 'A' | 'AAAA'
  name: string
  relativeName: string | null
  value: string
  ttlSeconds: number
}
export interface DomainRoutingRecord extends DomainRecord { managedBy: 'client' | 'soveris' }
export interface DomainAccess {
  state: 'eligible' | 'grace' | 'suspended' | 'unavailable'
  selected: boolean
  reason: string | null
  lossAt: LocalInstantValue | null
  accessUntil: LocalInstantValue | null
}
export interface DomainAuthority {
  evaluatedAt: LocalInstantValue
  nextBoundary: LocalInstantValue | null
  freshForSeconds: number
  boundaryRemainingSeconds: number | null
  active: boolean
  servingReason: string
  binding: DomainAccess
  product: DomainAccess | null
  canVerify: boolean
  verifyReason: string | null
  canRetry: boolean
  retryReason: string | null
  canSetPrimary: boolean
  primaryReason: string | null
  cooldownRemainingSeconds: number
  affectedResourceCount: number | null
}
export interface Domain {
  id: string
  clientId: string
  host: string
  bindingType: 'client' | 'product'
  productId: string | null
  revision: string
  isPrimary: boolean
  ownership: { status: 'pending' | 'verified' | 'expired' | 'failed'; verifiedAt: LocalInstantValue | null; validUntil: LocalInstantValue | null }
  verification: { generation: number; method: 'cname' | 'txt'; record: DomainRecord; lastCheckedAt: LocalInstantValue | null; nextCheckAt: LocalInstantValue | null; deadlineAt: LocalInstantValue; lastErrorCode: string | null; cooldownUntil: LocalInstantValue | null }
  routing: { status: 'disabled' | 'provisioning' | 'active' | 'suspended'; records: DomainRoutingRecord[] }
  tls: { status: 'pending' | 'ready' | 'failed' | 'expired' | 'not_required'; validUntil: LocalInstantValue | null }
  edge: { state: 'pending' | 'leased' | 'succeeded' | 'failed'; workKind: 'activation' | 'renewal'; attemptCount: number; nextActionAt: LocalInstantValue | null; lastErrorCode: string | null; acceptedAt: LocalInstantValue | null } | null
  createdAt: LocalInstantValue
  updatedAt: LocalInstantValue
  authority: DomainAuthority | null
}
export interface DomainPage { items: Domain[]; page: number; pageSize: number; totalCount: number; totalPages: number }
export interface DomainClaim {
  operationId: string
  host: string
  bindingType: 'client' | 'product'
  productId?: string | null
  verificationMethod: 'cname' | 'txt'
}
export interface DomainSchedule {
  domainId: string; statusUrl: string; ownershipStatus: Domain['ownership']['status']; generation: number
  nextCheckAt: LocalInstantValue | null; deadlineAt: LocalInstantValue; cooldownUntil: LocalInstantValue
  record: DomainRecord | null
}
export interface DomainRelease {
  releaseId: string; domainId: string; generation: number; statusUrl: string
  state: 'pending' | 'retrying' | 'action_required' | 'released'
  requestedAt: LocalInstantValue; nextAttemptAt: LocalInstantValue | null
  lastErrorCode: string | null; completedAt: LocalInstantValue | null
}
export type DomainLookup = { kind: 'domain'; domain: Domain } | { kind: 'release'; release: DomainRelease }
