import { isLosslessNumber, parse } from 'lossless-json'
import { canonicalizeGuid } from '../lib/guid'
import { parseLocalInstant } from '../timezone/LocalInstant'
import type { Domain, DomainAccess, DomainAuthority, DomainPage, DomainRecord, DomainRelease, DomainRoutingRecord, DomainSchedule } from '../types/domains'

export class DomainContractError extends Error {
  readonly code = 'DOMAIN_CONTRACT_ERROR'
  constructor() { super('The domain response could not be verified. Check current status.'); this.name = 'DomainContractError' }
}
const fail = (): never => { throw new DomainContractError() }
type Obj = Record<string, unknown>
function object(value: unknown, keys: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isLosslessNumber(value)) return fail()
  const result = value as Obj
  const allowed = keys.split(' ')
  if (Object.keys(result).length !== allowed.length || allowed.some(key => !Object.prototype.hasOwnProperty.call(result, key))) return fail()
  return result
}
function assertNoDuplicateJsonObjectKeys(text: string): void {
  const stack: Array<Set<string> | null> = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '{') {
      stack.push(new Set())
      continue
    }
    if (character === '[') {
      stack.push(null)
      continue
    }
    if (character === '}' || character === ']') {
      stack.pop()
      continue
    }
    if (character !== '"') continue
    const start = index
    let escaped = false
    for (index += 1; index < text.length; index += 1) {
      const next = text[index]!
      if (escaped) {
        escaped = false
      } else if (next === '\\') {
        escaped = true
      } else if (next === '"') {
        break
      }
    }
    let following = index + 1
    while (following < text.length && /\s/u.test(text[following]!)) following += 1
    const objectKeys = stack[stack.length - 1]
    if (text[following] === ':' && objectKeys instanceof Set) {
      let key: string
      try {
        key = JSON.parse(text.slice(start, index + 1)) as string
      } catch {
        continue
      }
      if (objectKeys.has(key)) {
        return fail()
      }
      objectKeys.add(key)
    }
  }
}

function json(text: string): unknown {
  try { assertNoDuplicateJsonObjectKeys(text); return parse(text, null, { onDuplicateKey: () => fail() }) } catch { return fail() }
}
function string(value: unknown): string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : fail() }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : fail() }
function numeric(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!isLosslessNumber(value)) return fail()
  const n = Number(value.toString())
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fail()
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = numeric(value, max); return Number.isSafeInteger(n) && n >= min ? n : fail()
}
function int64(value: unknown): string {
  if (!isLosslessNumber(value) || !/^[1-9]\d*$/.test(value.toString()) || BigInt(value.toString()) > 9223372036854775807n) return fail()
  return value.toString()
}
export function domainGuid(value: unknown, version7 = false): string {
  const guid = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!guid || guid === '00000000-0000-0000-0000-000000000000' || version7 && !/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(guid)) return fail()
  return guid
}
function one<T extends string>(value: unknown, values: readonly T[]): T { return typeof value === 'string' && values.includes(value as T) ? value as T : fail() }
function nullable<T>(value: unknown, read: (value: unknown) => T): T | null { return value === null ? null : read(value) }
function instant(value: unknown): string { try { return parseLocalInstant(value) } catch { return fail() } }
function list<T>(value: unknown, read: (value: unknown) => T, max = 100): T[] { return Array.isArray(value) && value.length <= max ? value.map(read) : fail() }
const dnsCodes = ['dns_nxdomain', 'dns_no_data', 'dns_mismatch', 'dns_timeout', 'dns_servfail', 'dns_provider_failure'] as const
const edgeCodes = ['route_failed', 'tls_pending', 'tls_failed', 'provider_failure', 'attempts_exhausted'] as const
const reasons = ['active', 'stale_capability_evidence', 'policy_suspended', 'product_ineligible', 'ownership_unavailable', 'tls_unavailable', 'routing_inactive', 'insufficient_permissions', 'configuration_unavailable', 'feature_not_available', 'transition_pending', 'limit_reached', 'verification_retry_required', 'verification_cooldown', 'verification_not_retryable', 'not_selected', 'limit_exceeded', 'client_disabled', 'ownership_expired', 'policy_unavailable', 'subscription_inactive', 'finite_limit', 'product_inactive', 'product_unpublished', 'ownership_unverified', 'target_product_not_retained', 'hard_denial'] as const
function record(value: unknown, routing = false): DomainRecord | DomainRoutingRecord {
  const v = object(value, `type name relativeName value ttlSeconds${routing ? ' managedBy' : ''}`)
  const result: DomainRecord = { type: one(v.type, ['CNAME', 'TXT', 'ALIAS', 'A', 'AAAA']), name: string(v.name), relativeName: nullable(v.relativeName, string), value: string(v.value), ttlSeconds: integer(v.ttlSeconds, 1, 2147483647) }
  return routing ? { ...result, managedBy: one(v.managedBy, ['client', 'soveris']) } : result
}
function access(value: unknown): DomainAccess {
  const v = object(value, 'state selected reason lossAt accessUntil')
  return { state: one(v.state, ['eligible', 'grace', 'suspended', 'unavailable']), selected: bool(v.selected), reason: nullable(v.reason, x => one(x, reasons)), lossAt: nullable(v.lossAt, instant), accessUntil: nullable(v.accessUntil, instant) }
}
function authority(value: unknown): DomainAuthority {
  const v = object(value, 'evaluatedAt nextBoundary freshForSeconds boundaryRemainingSeconds active servingReason binding product canVerify verifyReason canRetry retryReason canSetPrimary primaryReason cooldownRemainingSeconds affectedResourceCount')
  const result: DomainAuthority = {
    evaluatedAt: instant(v.evaluatedAt), nextBoundary: nullable(v.nextBoundary, instant),
    freshForSeconds: numeric(v.freshForSeconds, 5), boundaryRemainingSeconds: nullable(v.boundaryRemainingSeconds, numeric),
    active: bool(v.active), servingReason: one(v.servingReason, reasons), binding: access(v.binding), product: nullable(v.product, access),
    canVerify: bool(v.canVerify), verifyReason: nullable(v.verifyReason, x => one(x, reasons)),
    canRetry: bool(v.canRetry), retryReason: nullable(v.retryReason, x => one(x, reasons)),
    canSetPrimary: bool(v.canSetPrimary), primaryReason: nullable(v.primaryReason, x => one(x, reasons)),
    cooldownRemainingSeconds: numeric(v.cooldownRemainingSeconds, 30), affectedResourceCount: nullable(v.affectedResourceCount, integer),
  }
  if (result.active !== (result.servingReason === 'active') ||
      result.canVerify !== (result.verifyReason === null) || result.canRetry !== (result.retryReason === null) ||
      result.canSetPrimary !== (result.primaryReason === null)) return fail()
  return result
}
function domain(value: unknown, expectedClientId: string, current: boolean): Domain {
  const v = object(value, 'id clientId host bindingType productId revision isPrimary ownership verification routing tls edge createdAt updatedAt authority')
  const clientId = domainGuid(v.clientId)
  if (clientId !== domainGuid(expectedClientId)) return fail()
  const o = object(v.ownership, 'status verifiedAt validUntil')
  const check = object(v.verification, 'generation method record lastCheckedAt nextCheckAt deadlineAt lastErrorCode cooldownUntil')
  const route = object(v.routing, 'status records'), tls = object(v.tls, 'status validUntil')
  const result: Domain = {
    id: domainGuid(v.id, true), clientId, host: string(v.host), bindingType: one(v.bindingType, ['client', 'product']),
    productId: nullable(v.productId, domainGuid), revision: int64(v.revision), isPrimary: bool(v.isPrimary),
    ownership: { status: one(o.status, ['pending', 'verified', 'expired', 'failed']), verifiedAt: nullable(o.verifiedAt, instant), validUntil: nullable(o.validUntil, instant) },
    verification: { generation: integer(check.generation, 1, 2147483647), method: one(check.method, ['cname', 'txt']), record: record(check.record),
      lastCheckedAt: nullable(check.lastCheckedAt, instant), nextCheckAt: nullable(check.nextCheckAt, instant), deadlineAt: instant(check.deadlineAt),
      lastErrorCode: nullable(check.lastErrorCode, x => one(x, dnsCodes)), cooldownUntil: nullable(check.cooldownUntil, instant) },
    routing: { status: one(route.status, ['disabled', 'provisioning', 'active', 'suspended']), records: list(route.records, x => record(x, true) as DomainRoutingRecord) },
    tls: { status: one(tls.status, ['pending', 'ready', 'failed', 'expired', 'not_required']), validUntil: nullable(tls.validUntil, instant) },
    edge: nullable(v.edge, value => {
      const e = object(value, 'state workKind attemptCount nextActionAt lastErrorCode acceptedAt')
      return { state: one(e.state, ['pending', 'leased', 'succeeded', 'failed']), workKind: one(e.workKind, ['activation', 'renewal']), attemptCount: integer(e.attemptCount), nextActionAt: nullable(e.nextActionAt, instant), lastErrorCode: nullable(e.lastErrorCode, x => one(x, edgeCodes)), acceptedAt: nullable(e.acceptedAt, instant) }
    }), createdAt: instant(v.createdAt), updatedAt: instant(v.updatedAt), authority: nullable(v.authority, authority),
  }
  if ((result.bindingType === 'product') !== (result.productId !== null) || current && !result.authority || result.authority && (result.productId !== null) !== (result.authority.product !== null)) return fail()
  if (result.authority?.active && (result.ownership.status !== 'verified' || result.routing.status !== 'active' || result.tls.status !== 'ready' || !result.ownership.validUntil || !result.tls.validUntil || !['eligible', 'grace'].includes(result.authority.binding.state) || result.authority.product && !['eligible', 'grace'].includes(result.authority.product.state))) return fail()
  return result
}
export function parseDomain(text: string, clientId: string, current = true): Domain { return domain(json(text), clientId, current) }
export function parseDomainPage(text: string, clientId: string): DomainPage {
  const v = object(json(text), 'items page pageSize totalCount totalPages')
  return { items: list(v.items, x => domain(x, clientId, true)), page: integer(v.page, 1), pageSize: integer(v.pageSize, 1, 100), totalCount: integer(v.totalCount), totalPages: integer(v.totalPages) }
}
export function parseDomainSchedule(text: string, id: string): DomainSchedule {
  const v = object(json(text), 'domainId statusUrl ownershipStatus generation nextCheckAt deadlineAt cooldownUntil record')
  if (domainGuid(v.domainId, true) !== domainGuid(id, true) || v.statusUrl !== `/api/backoffice/domains/${id}`) return fail()
  return { domainId: id, statusUrl: v.statusUrl as string, ownershipStatus: one(v.ownershipStatus, ['pending', 'verified', 'expired', 'failed']), generation: integer(v.generation, 1), nextCheckAt: nullable(v.nextCheckAt, instant), deadlineAt: instant(v.deadlineAt), cooldownUntil: instant(v.cooldownUntil), record: nullable(v.record, record) }
}
export function parseDomainRelease(text: string, id: string): DomainRelease {
  const v = object(json(text), 'releaseId domainId generation statusUrl state requestedAt nextAttemptAt lastErrorCode completedAt')
  if (domainGuid(v.domainId, true) !== domainGuid(id, true) || v.statusUrl !== `/api/backoffice/domains/${id}/release`) return fail()
  if ((v.state === 'released') !== (v.completedAt !== null)) return fail()
  return { releaseId: domainGuid(v.releaseId, true), domainId: id, generation: integer(v.generation, 1), statusUrl: v.statusUrl as string, state: one(v.state, ['pending', 'retrying', 'action_required', 'released']), requestedAt: instant(v.requestedAt), nextAttemptAt: nullable(v.nextAttemptAt, instant), lastErrorCode: nullable(v.lastErrorCode, x => one(x, ['provider_pending', 'provider_failure', 'provider_timeout'])), completedAt: nullable(v.completedAt, instant) }
}
