import { isLosslessNumber, parse, stringify } from 'lossless-json'
import { supportClockNow } from './clock'
import { SUPPORT, SUPPORT_RATE_REJECTED, SUPPORT_COMMAND_KINDS, SUPPORT_CASE, SUPPORT_FIELDS, SUPPORT_HASH, SUPPORT_OPERATIONS, SUPPORT_REVISION, SUPPORT_STATES, SUPPORT_UTC, SUPPORT_UUID, SUPPORT_UUID_V7 } from './constants'
import type { SupportOperationReceipt, SupportClockObservation, SupportCustomerLabel, SupportProductLabel, SupportLabels, SupportLookupPage, SupportContext, SupportDraft, SupportGrantScope, SupportIdentity, SupportMetadata, SupportOutcome, SupportPage, SupportRead, SupportState } from './models'

export function invalidSupportResponse(): never {
  throw new Error('Current support access is unavailable. Verify the current state before continuing.')
}

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidSupportResponse()
  }

  const result = value as Record<string, unknown>

  if (Object.keys(result).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(result, field))) {
    return invalidSupportResponse()
  }

  return result
}

export function supportId(value: unknown, versionSeven = false): string {
  if (typeof value !== 'string' || !(versionSeven ? SUPPORT_UUID_V7 : SUPPORT_UUID).test(value) || value === '00000000-0000-0000-0000-000000000000') {
    return invalidSupportResponse()
  }

  return value
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || Array.from(value).length > maximum || /[\uD800-\uDFFF]/u.test(value)) {
    return invalidSupportResponse()
  }

  return value
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !SUPPORT_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    return invalidSupportResponse()
  }

  return value
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value)
}

function integer(value: unknown, minimum = 0, maximum = 9223372036854775807n): string {
  const raw = isLosslessNumber(value) ? value.toString() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value

  if (typeof raw !== 'string' || !SUPPORT_REVISION.test(raw) || BigInt(raw) < BigInt(minimum) || BigInt(raw) > maximum) {
    return invalidSupportResponse()
  }

  return raw
}

function state(value: unknown): SupportState {
  if (!SUPPORT_STATES.includes(value as SupportState)) {
    return invalidSupportResponse()
  }

  return value as SupportState
}

export function parseSupportCustomer(input: unknown): SupportCustomerLabel {
  const value = object(input, ['id', 'name'])
  const name = text(value.name, 500)

  if (!name.trim()) {
    return invalidSupportResponse()
  }

  return { id: supportId(value.id), name }
}

export function parseSupportProduct(input: unknown): SupportProductLabel {
  const value = object(input, ['id', 'name', 'slug'])
  const name = text(value.name, 500)
  const slug = text(value.slug, 500)

  if (!name.trim() || !slug.trim()) {
    return invalidSupportResponse()
  }

  return { id: supportId(value.id), name, slug }
}

export function parseSupportLookup<TLabel extends SupportCustomerLabel>(input: unknown, decode: (value: unknown) => TLabel): SupportLookupPage<TLabel> {
  const value = object(input, ['items', 'nextCursor'])

  if (!Array.isArray(value.items) || value.items.length > SUPPORT.maximumPageSize
      || value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value.nextCursor))) {
    return invalidSupportResponse()
  }

  const items = value.items.map(decode)

  if (new Set(items.map(item => item.id)).size !== items.length) {
    return invalidSupportResponse()
  }

  return { items, nextCursor: value.nextCursor as string | null }
}

function labels(input: unknown, grant: SupportGrantScope): SupportLabels | null {
  if (input === null) {
    return null
  }

  const value = object(input, ['operatorId', 'operatorName', 'targetClientId', 'targetClientName', 'products'])

  if (value.operatorId !== grant.operatorId || value.targetClientId !== grant.targetClientId || !Array.isArray(value.products)) {
    return invalidSupportResponse()
  }

  const products = value.products.map(parseSupportProduct)

  if (products.length !== grant.productIds.length || products.some((product, index) => product.id !== grant.productIds[index])) {
    return invalidSupportResponse()
  }

  return { operatorId: grant.operatorId, operatorName: value.operatorName === null ? '' : text(value.operatorName, 500), targetClientId: grant.targetClientId,
    targetClientName: value.targetClientName === null ? '' : text(value.targetClientName, 500), products }
}

function scope(value: Record<string, unknown>): SupportGrantScope {
  const products = value.productIds
  const operations = value.operations

  if (!Array.isArray(products) || products.length < 1 || products.length > SUPPORT.maximumProducts ||
    products.some((product, index) => supportId(product) !== product || index > 0 && products[index - 1] >= product) ||
    !Array.isArray(operations) || operations.length < 1 || operations.length > SUPPORT_OPERATIONS.length ||
    operations.some((operation, index) => !SUPPORT_OPERATIONS.includes(operation) || index > 0 && operations[index - 1] >= operation) ||
    value.scopeVersion !== SUPPORT.scopeVersion || typeof value.scopeHash !== 'string' || !SUPPORT_HASH.test(value.scopeHash)) {
    return invalidSupportResponse()
  }

  if (!Array.isArray(value.products)) {
    return invalidSupportResponse()
  }

  const productLabels = value.products.map(parseSupportProduct)

  if (productLabels.length > 0 && (productLabels.length !== products.length || productLabels.some((product, index) => product.id !== products[index]))) {
    return invalidSupportResponse()
  }

  return { products: productLabels, originalWorkspaceName: value.originalWorkspaceName === null ? null : text(value.originalWorkspaceName, 500),
    supportCaseReference: text(value.supportCaseReference, SUPPORT.maximumReferenceCharacters), createdAt: instant(value.createdAt),
    id: supportId(value.id, true), operatorId: supportId(value.operatorId), operatorName: value.operatorName === null ? '' : text(value.operatorName, 500),
    targetClientId: supportId(value.targetClientId), targetClientName: value.targetClientName === null ? '' : text(value.targetClientName, 500), productIds: [...products],
    operations: [...operations] as SupportRead[], scopeVersion: SUPPORT.scopeVersion, scopeHash: value.scopeHash,
    revision: integer(value.revision, 1), state: state(value.state), startsAt: nullableInstant(value.startsAt), expiresAt: nullableInstant(value.expiresAt) }
}

export function parseSupportContext(input: unknown, clock: SupportClockObservation): SupportContext {
  const value = scope(object(input, SUPPORT_FIELDS.context))

  if (value.state !== 'active' || !value.startsAt || !value.expiresAt || Date.parse(value.expiresAt) <= supportClockNow(clock) ||
    Date.parse(value.expiresAt) <= Date.parse(value.startsAt) || Date.parse(value.expiresAt) - Date.parse(value.startsAt) > SUPPORT.maximumMinutes * 60000) {
    return invalidSupportResponse()
  }

  return { ...value, clock, state: 'active', startsAt: value.startsAt, expiresAt: value.expiresAt }
}

export function parseSupportMetadata(input: unknown): SupportMetadata {
  const value = object(input, [...SUPPORT_FIELDS.context, ...SUPPORT_FIELDS.metadata])
  const reason = text(value.reason, SUPPORT.maximumReasonScalars)
  const reference = text(value.supportCaseReference, SUPPORT.maximumReferenceCharacters)

  if (!reason.trim() || reason !== reason.trim() || /\p{Cc}/u.test(reason) || !SUPPORT_CASE.test(reference)) {
    return invalidSupportResponse()
  }

  const grant = scope(value)

  if (typeof value.labelsChanged !== 'boolean' || value.labelReviewHash !== null && (typeof value.labelReviewHash !== 'string' || !SUPPORT_HASH.test(value.labelReviewHash))) {
    return invalidSupportResponse()
  }

  return { ...grant, labelReviewHash: value.labelReviewHash as string | null, requestLabels: labels(value.requestLabels, grant),
    currentLabels: labels(value.currentLabels, grant), labelsChanged: value.labelsChanged, durationMinutes: Number(integer(value.durationMinutes, 1, BigInt(SUPPORT.maximumMinutes))), reason,
    supportCaseReference: reference, createdAt: instant(value.createdAt), requestExpiresAt: instant(value.requestExpiresAt),
    approvedAt: nullableInstant(value.approvedAt), activationDeadline: nullableInstant(value.activationDeadline),
    endedAt: nullableInstant(value.endedAt), terminalReason: value.terminalReason === null ? null : text(value.terminalReason, 64) }
}

export function parseSupportPage(input: unknown): SupportPage {
  const value = object(input, ['items', 'nextCursor'])

  if (!Array.isArray(value.items) || value.items.length > SUPPORT.maximumPageSize) {
    return invalidSupportResponse()
  }

  return { items: value.items.map(parseSupportMetadata), nextCursor: value.nextCursor === null ? null : supportId(value.nextCursor, true) }
}

export function parseSupportOutcome(input: unknown): SupportOutcome {
  const value = object(input, SUPPORT_FIELDS.outcome)
  return { id: supportId(value.id, true), state: state(value.state), revision: integer(value.revision, 1), createdAt: instant(value.createdAt),
    approvedAt: nullableInstant(value.approvedAt), startsAt: nullableInstant(value.startsAt), expiresAt: nullableInstant(value.expiresAt), endedAt: nullableInstant(value.endedAt) }
}

export function parseSupportJson(raw: string): unknown {
  if (new TextEncoder().encode(raw).byteLength > SUPPORT.maximumResponseBytes) {
    return invalidSupportResponse()
  }

  return parse(raw) as unknown
}

function schema(value: unknown): number | null {
  return value === null ? null : Number(integer(value, 1, 2147483647n))
}

export function parseSupportDraft(raw: string): SupportDraft {
  const value = object(parseSupportJson(raw), SUPPORT_FIELDS.draft)
  const draftJson = stringify(value.draft)

  if (draftJson === undefined || new TextEncoder().encode(draftJson).byteLength > SUPPORT.maximumDraftBytes) {
    return invalidSupportResponse()
  }

  return { kind: 'draft', productId: supportId(value.productId), draftSchemaVersion: schema(value.draftSchemaVersion),
    draftRevision: integer(value.draftRevision), draftJson }
}

export function parseSupportIdentity(raw: string): SupportIdentity {
  const value = object(parseSupportJson(raw), SUPPORT_FIELDS.identity)
  return { kind: 'identity', productId: supportId(value.id), clientId: supportId(value.clientId), name: text(value.name, 500), slug: text(value.slug, 500),
    status: Number(integer(value.status, 0, 1n)), revision: integer(value.revision, 1), draftSchemaVersion: schema(value.draftSchemaVersion), draftRevision: integer(value.draftRevision) }
}

export function parseSupportReceipt(input: unknown): SupportOperationReceipt {
  const value = object(input, SUPPORT_FIELDS.receipt)

  if (!SUPPORT_COMMAND_KINDS.includes(value.command as typeof SUPPORT_COMMAND_KINDS[number])) {
    return invalidSupportResponse()
  }

  let outcome: SupportOperationReceipt['outcome']

  if (value.outcome && typeof value.outcome === 'object' && 'status' in value.outcome) {
    const rejected = object(value.outcome, SUPPORT_FIELDS.rejectedOutcome)
    const retryAfter = Number(integer(rejected.retryAfter, 1, BigInt(SUPPORT.maximumRetrySeconds)))

    if (!(isLosslessNumber(rejected.status) || typeof rejected.status === 'number')
      || !(isLosslessNumber(rejected.retryAfter) || typeof rejected.retryAfter === 'number')
      || Number(rejected.status) !== 429 || rejected.code !== SUPPORT_RATE_REJECTED
      || typeof rejected.requestHash !== 'string' || !SUPPORT_HASH.test(rejected.requestHash)) {
      return invalidSupportResponse()
    }

    outcome = { status: 429, code: SUPPORT_RATE_REJECTED, requestHash: rejected.requestHash, retryAfter }
  } else {
    outcome = parseSupportOutcome(value.outcome)
  }

  return { operationId: supportId(value.operationId, true), command: value.command as SupportOperationReceipt['command'], outcome }
}
