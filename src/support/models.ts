import type { AuthUser } from '../types/auth'
import type { SUPPORT_COMMAND_KINDS, SUPPORT_STATES } from './constants'

export type SupportState = typeof SUPPORT_STATES[number]
export type SupportRead = 'product.identity.read' | 'product.draft.read'
export interface SupportCustomerLabel { id: string; name: string }
export interface SupportProductLabel extends SupportCustomerLabel { slug: string }
export interface SupportLabels {
  operatorId: string
  operatorName: string
  targetClientId: string
  targetClientName: string
  products: SupportProductLabel[]
}
export interface SupportLookupPage<TLabel> { items: TLabel[]; nextCursor: string | null }
export interface SupportGrantScope {
  id: string
  operatorId: string
  operatorName: string
  targetClientId: string
  targetClientName: string
  products: readonly SupportProductLabel[]
  originalWorkspaceName: string | null
  supportCaseReference: string
  createdAt: string
  productIds: readonly string[]
  operations: readonly SupportRead[]
  scopeVersion: 'support-read-v1'
  scopeHash: string
  revision: string
  state: SupportState
  startsAt: string | null
  expiresAt: string | null
}
export interface SupportContext extends SupportGrantScope {
  clock: SupportClockObservation
  state: 'active'
  startsAt: string
  expiresAt: string
}
export interface SupportClockObservation { serverMilliseconds: number; monotonicMilliseconds: number }
export interface SupportInboxSnapshot {
  scope: string
  generation: number
  page: SupportPage
  detail: SupportMetadata | null
  checkedAt: string
}
export interface SupportMetadata extends SupportGrantScope {
  clock?: SupportClockObservation
  labelReviewHash: string | null
  requestLabels: SupportLabels | null
  currentLabels: SupportLabels | null
  labelsChanged: boolean
  durationMinutes: number
  reason: string
  supportCaseReference: string
  createdAt: string
  requestExpiresAt: string
  approvedAt: string | null
  activationDeadline: string | null
  endedAt: string | null
  terminalReason: string | null
}
export interface SupportOutcome {
  id: string
  state: SupportState
  revision: string
  createdAt: string
  approvedAt: string | null
  startsAt: string | null
  expiresAt: string | null
  endedAt: string | null
}
export interface SupportRequest {
  operationId: string
  targetClientId: string
  productIds: string[]
  operations: SupportRead[]
  durationMinutes: number
  reason: string
  supportCaseReference: string
}
export interface SupportCommand {
  operationId: string
  expectedRevision: string
  scopeHash?: string
  labelReviewHash?: string
}
export interface SupportDraft {
  kind: 'draft'
  productId: string
  draftSchemaVersion: number | null
  draftRevision: string
  draftJson: string
}
export interface SupportIdentity {
  kind: 'identity'
  productId: string
  clientId: string
  name: string
  slug: string
  status: number
  revision: string
  draftSchemaVersion: number | null
  draftRevision: string
}
export type SupportProjection = SupportDraft | SupportIdentity
export interface SupportPage {
  items: SupportMetadata[]
  nextCursor: string | null
}
export interface SupportNotice {
  status: number
  field?: 'customer' | 'products'
  code?: string
  message: string
  retryAt: number
}
export interface SupportTransportBoundary {
  capture: () => { accessToken: string; isCurrent: () => boolean }
  retire: (notice: SupportNotice) => void
}
export interface SupportSnapshot {
  generation: number
  scopeKey: string | null
  context: SupportContext | null
  projection: SupportProjection | null
  notice: SupportNotice | null
}
export interface SupportCapture {
  generation: number
  isCurrent: () => boolean
}
export interface SupportAuthorityStore {
  clearNotice: (generation: number) => void
  snapshot: () => SupportSnapshot
  subscribe: (listener: () => void) => () => void
  bind: (context: SupportContext, actor: AuthUser) => void
  retain: (projection: SupportProjection, generation: number) => boolean
  retire: (notice?: SupportNotice) => void
  capture: () => SupportCapture
  own: (controller: AbortController) => () => void
}

export interface SupportRequestDraft {
  customerGeneration: number
  target: string
  products: string
  minutes: string
  reason: string
  reference: string
  operations: SupportRead[]
}

export type SupportCommandKind = typeof SUPPORT_COMMAND_KINDS[number]
export interface SupportOperationReceipt { operationId: string; command: SupportCommandKind; outcome: SupportOutcome | SupportRejectedOutcome }
export interface PendingSupportCommand { kind: SupportCommandKind; body: SupportRequest | SupportCommand; grant?: string }

export interface SupportRejectedOutcome { status: 429; code: 'rate_limited_before_effect'; requestHash: string; retryAfter: number }
