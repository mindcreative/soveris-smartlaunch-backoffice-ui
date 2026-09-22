import { isLosslessNumber, LosslessNumber, parse, stringify } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import {
  BILLING_LEDGER_TRANSACTION_TYPES,
  type BillingAccountSnapshot,
  type BillingAccountStatus,
  type BillingEntitlementsV1,
  type BillingLedgerFilters,
  type BillingLedgerItem,
  type BillingLedgerPage,
  type BillingLedgerPageRequest,
  type BillingLedgerTransactionType,
  type BillingSubscriptionChangePolicy,
  type BillingSubscriptionCreationReceipt,
  type BillingSubscriptionGrant,
  type BillingSubscriptionImmediateContext,
  type BillingSubscriptionImmediateDebit,
  type BillingSubscriptionItem,
  type BillingSubscriptionLifecycleAction,
  type BillingSubscriptionLifecycleReceipt,
  type BillingSubscriptionLifecycleRequest,
  type BillingSubscriptionPageRequest,
  type BillingSubscriptionPendingChange,
  type BillingSubscriptionPendingTierChange,
  type BillingSubscriptionProrationPolicy,
  type BillingSubscriptionState,
  type BillingSubscriptionTier,
  type BillingSubscriptionUnsupportedView,
  type CreateBillingSubscriptionRequest,
  type BillingSubscriptionTierAction,
  type BillingSubscriptionTierChangeRequest,
  type BillingSubscriptionTierChangeResponse,
  type BillingSubscriptionTierState,
  type ResourceAccessConsequence,
  type ResourceAccessConsequenceResource,
  type ResourceAccessPreview,
  type ResourceAccessPreviewAction,
  type ResourceAccessPreviewRequest,
  type ResourceAccessPreviewResource,
  type BillingLedgerExportAccepted,
  type BillingLedgerExportAttempt,
  type BillingLedgerExportFailureCode,
  type BillingLedgerExportFilters,
  type BillingLedgerExportReference,
  type BillingLedgerExportStatus,
  type BillingLedgerExportStatusMetadata,
  type BillingLedgerExportStatusResult,
  CLIENT_CAPABILITY_KEYS,
  type ClientCapabilities,
  type ClientCapabilityDenialCondition,
  type ClientCapabilityEvidenceStatus,
  type ClientCapabilityFundingEvidence,
  type ClientCapabilityKey,
  type ClientCapabilityLimit,
  type ClientCapabilityLimitKey,
  type ClientCapabilityOperation,
  type ClientCapabilityPolicySource,
  type ClientCapabilitySubscription,
  type ClientCapabilityUsage,
  type ClientClassification,
} from '../types/billing'

const SNAPSHOT_KEYS = [
  'activeReservationCount',
  'activelyReservedAmount',
  'asOf',
  'availableBalance',
  'clientId',
  'creditAccountId',
  'ownedBalance',
  'status',
  'walletVersion',
] as const

const DECIMAL_18_4_PATTERN = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const UTC_OFFSET_PATTERN = /(Z|\+00:00)$/i
const INT64_MAX = 9_223_372_036_854_775_807n
const ACCOUNT_STATUSES = new Set<BillingAccountStatus>(['active', 'suspended', 'closed'])
const LEDGER_TRANSACTION_TYPES = new Set<BillingLedgerTransactionType>(BILLING_LEDGER_TRANSACTION_TYPES)
const LEDGER_PAGE_KEYS = ['asOf', 'items', 'nextCursor'] as const
const LEDGER_ITEM_KEYS = [
  'actorUserId',
  'adjustmentId',
  'amount',
  'balanceAfter',
  'createdAt',
  'creditAccountId',
  'jobId',
  'ledgerId',
  'operationId',
  'reason',
  'reservationId',
  'ruleId',
  'ruleVersion',
  'transactionType',
] as const

export class BillingContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing snapshot: ${reason}`)
    this.name = 'BillingContractError'
  }
}

export class BillingLedgerContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing ledger: ${reason}`)
    this.name = 'BillingLedgerContractError'
  }
}

export class BillingLedgerExportContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing ledger export: ${reason}`)
    this.name = 'BillingLedgerExportContractError'
  }
}

function contractError(reason: string): BillingContractError {
  return new BillingContractError(reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function readExactDecimal(value: unknown, field: string): string {
  if (!isLosslessNumber(value)) {
    throw contractError(`${field} must be a JSON number`)
  }

  const exact = value.toString()
  if (!DECIMAL_18_4_PATTERN.test(exact)) {
    throw contractError(`${field} is outside the DECIMAL(18,4) contract`)
  }

  return exact
}

function readReservationCount(value: unknown): number {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw contractError('activeReservationCount must be a non-negative integer')
  }

  const count = Number(value.toString())
  if (!Number.isSafeInteger(count) || count > 2_147_483_647) {
    throw contractError('activeReservationCount is outside the Int32 contract')
  }

  return count
}

function readWalletVersion(value: unknown): string {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw contractError('walletVersion must be a non-negative Int64')
  }
  const lexeme = value.toString()
  if (BigInt(lexeme) > INT64_MAX) {
    throw contractError('walletVersion must be a non-negative Int64')
  }
  return lexeme
}

function readUtcInstant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !UTC_OFFSET_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw contractError('asOf must be a UTC DateTimeOffset')
  }

  return value
}

export function parseBillingAccountSnapshot(
  text: string,
  expectedClientId: string
): BillingAccountSnapshot {
  const expectedClient = canonicalizeGuid(expectedClientId)
  if (!expectedClient) {
    throw contractError('expected Client ID is invalid')
  }

  let payload: unknown
  try {
    payload = parse(text)
  } catch {
    throw contractError('response is not valid JSON')
  }
  if (!isRecord(payload)) {
    throw contractError('payload must be an object')
  }

  const actualKeys = Object.keys(payload).sort()
  if (
    actualKeys.length !== SNAPSHOT_KEYS.length ||
    actualKeys.some((key, index) => key !== SNAPSHOT_KEYS[index])
  ) {
    throw contractError('payload fields do not match the closed contract')
  }

  const creditAccountId = canonicalizeGuid(
    typeof payload.creditAccountId === 'string' ? payload.creditAccountId : undefined
  )
  const clientId = canonicalizeGuid(
    typeof payload.clientId === 'string' ? payload.clientId : undefined
  )
  if (!creditAccountId || !clientId) {
    throw contractError('account and Client IDs must be GUIDs')
  }
  if (clientId !== expectedClient) {
    throw contractError('response Client does not match the requested Client')
  }

  if (
    typeof payload.status !== 'string' ||
    !ACCOUNT_STATUSES.has(payload.status as BillingAccountStatus)
  ) {
    throw contractError('status is not supported')
  }

  return {
    creditAccountId,
    clientId,
    ownedBalance: readExactDecimal(payload.ownedBalance, 'ownedBalance'),
    activelyReservedAmount: readExactDecimal(
      payload.activelyReservedAmount,
      'activelyReservedAmount'
    ),
    availableBalance: readExactDecimal(payload.availableBalance, 'availableBalance'),
    activeReservationCount: readReservationCount(payload.activeReservationCount),
    status: payload.status as BillingAccountStatus,
    asOf: readUtcInstant(payload.asOf),
    walletVersion: readWalletVersion(payload.walletVersion),
  }
}

export async function getBillingAccountSnapshot(
  clientId: string,
  signal?: AbortSignal
): Promise<BillingAccountSnapshot> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) {
    throw contractError('requested Client ID is invalid')
  }

  const response = await apiClient.getApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/account`,
    { responseType: 'text', signal }
  )
  if (typeof response.data !== 'string') {
    throw contractError('response must be JSON text')
  }

  return parseBillingAccountSnapshot(response.data, canonicalClientId)
}

const CAPABILITY_TOP_KEYS = [
  'classification', 'classificationRevision', 'classificationSource', 'clientId',
  'evaluatedAt', 'flags', 'limits', 'nextBoundary', 'operations', 'policySource',
  'policyVersion', 'subscription', 'usage',
] as const
const CAPABILITY_SUBSCRIPTION_KEYS = [
  'effectiveTier', 'status', 'storedTier', 'tierRevision', 'validFrom', 'validTo',
] as const
const CAPABILITY_FLAG_KEYS = ['enabled', 'key'] as const
const CAPABILITY_LIMIT_KEYS = ['key', 'unit', 'value'] as const
const CAPABILITY_USAGE_KEYS = ['key', 'measuredAt', 'unit', 'value'] as const
const CAPABILITY_OPERATION_KEYS = [
  'denialConditions', 'entitlement', 'feature', 'funding', 'key', 'outcome',
  'permission', 'pricing', 'provider', 'resourceLimit',
] as const
const CAPABILITY_KEY_SET = new Set<string>(CLIENT_CAPABILITY_KEYS)
const CAPABILITY_LIMIT_UNITS = new Map<ClientCapabilityLimitKey, ClientCapabilityLimit['unit']>([
  ['active_products', 'count'],
  ['hostnames', 'count'],
  ['storage_bytes', 'bytes'],
  ['requests_per_minute', 'requests_per_minute'],
  ['concurrent_ai_operations', 'count'],
  ['retention_days', 'days'],
])
const CAPABILITY_EVIDENCE = new Set<ClientCapabilityEvidenceStatus>([
  'satisfied', 'denied', 'unavailable', 'not_applicable',
])
const CAPABILITY_FUNDING = new Set<ClientCapabilityFundingEvidence>([
  'not_applicable', 'wallet_missing', 'wallet_ineligible', 'zero_available',
  'available_requires_quote', 'sufficient_for_quote', 'insufficient_credits', 'unavailable',
])
const CAPABILITY_DENIALS = new Set<ClientCapabilityDenialCondition>([
  'permission_denied', 'client_inactive', 'feature_not_available',
  'entitlement_not_available', 'limit_reached', 'provider_unavailable',
  'pricing_unavailable', 'wallet_missing', 'wallet_ineligible', 'insufficient_credits',
  'configuration_unavailable', 'dependency_unavailable', 'transition_pending',
  'stale_capability_evidence',
])
const CAPABILITY_CLASSIFICATIONS = new Set<ClientClassification>(['customer', 'soveris_internal'])
const CAPABILITY_POLICY_SOURCES = new Set<ClientCapabilityPolicySource>([
  'internal', 'customer_subscription', 'customer_freemium',
])

export class ClientCapabilitiesContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Client capabilities: ${reason}`)
    this.name = 'ClientCapabilitiesContractError'
  }
}

function capabilityError(reason: string): ClientCapabilitiesContractError {
  return new ClientCapabilitiesContractError(reason)
}

function parseCapabilitiesPayload(text: string): Record<string, unknown> {
  try {
    assertNoDuplicateJsonObjectKeys(text)
  } catch {
    throw capabilityError('response contains a duplicate object property')
  }
  let value: unknown
  try {
    value = parse(text)
  } catch {
    throw capabilityError('response is not valid JSON')
  }
  if (!isRecord(value)) throw capabilityError('payload must be an object')
  return value
}

function readCapabilityInt64(value: unknown, field: string, positive = false): string {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw capabilityError(`${field} must be a JSON non-negative Int64`)
  }
  const lexeme = value.toString()
  if (BigInt(lexeme) > INT64_MAX || (positive && lexeme === '0')) {
    throw capabilityError(`${field} must be a JSON non-negative Int64`)
  }
  return lexeme
}

function readCapabilityInstant(value: unknown, field: string): string {
  const instant = typeof value === 'string' ? value : ''
  const match = SUBSCRIPTION_INSTANT_PATTERN.exec(instant)
  if (!match || Number.isNaN(Date.parse(instant))) {
    throw capabilityError(`${field} must be a UTC instant`)
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const check = new Date(0)
  check.setUTCFullYear(year!, month! - 1, day!)
  check.setUTCHours(hour!, minute!, second!, 0)
  if (year! < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month! - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    throw capabilityError(`${field} must be a UTC instant`)
  }
  return instant
}

function readCapabilityTier(value: unknown, nullable: boolean): BillingSubscriptionTier | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !SUBSCRIPTION_TIERS.has(value as BillingSubscriptionTier)) {
    throw capabilityError('subscription tier is unsupported')
  }
  return value as BillingSubscriptionTier
}

function parseCapabilitySubscription(value: unknown): ClientCapabilitySubscription | null {
  if (value === null) return null
  if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_SUBSCRIPTION_KEYS)) {
    throw capabilityError('subscription fields do not match the closed contract')
  }
  const storedTier = readCapabilityTier(value.storedTier, false)!
  const effectiveTier = readCapabilityTier(value.effectiveTier, true)
  if (typeof value.status !== 'string' || !SUBSCRIPTION_STATUSES.has(value.status)) {
    throw capabilityError('subscription status is unsupported')
  }
  const validFrom = readCapabilityInstant(value.validFrom, 'validFrom')
  const validTo = value.validTo === null ? null : readCapabilityInstant(value.validTo, 'validTo')
  if (validTo !== null && Date.parse(validTo) <= Date.parse(validFrom)) {
    throw capabilityError('subscription validity is inconsistent')
  }
  return {
    storedTier,
    effectiveTier,
    status: value.status as ClientCapabilitySubscription['status'],
    tierRevision: readCapabilityInt64(value.tierRevision, 'tierRevision'),
    validFrom,
    validTo,
  }
}

function readCapabilityEvidence(value: unknown, field: string): ClientCapabilityEvidenceStatus {
  if (typeof value !== 'string' || !CAPABILITY_EVIDENCE.has(value as ClientCapabilityEvidenceStatus)) {
    throw capabilityError(`${field} evidence is unsupported`)
  }
  return value as ClientCapabilityEvidenceStatus
}

function parseCapabilityOperation(
  value: unknown,
  classification: ClientClassification,
  flag: boolean
): ClientCapabilityOperation {
  if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_OPERATION_KEYS) ||
      typeof value.key !== 'string' || !CAPABILITY_KEY_SET.has(value.key)) {
    throw capabilityError('operation fields do not match the closed contract')
  }
  const key = value.key as ClientCapabilityKey
  const isAi = key.startsWith('ai_')
  const permission = readCapabilityEvidence(value.permission, 'permission')
  const feature = readCapabilityEvidence(value.feature, 'feature')
  const entitlement = readCapabilityEvidence(value.entitlement, 'entitlement')
  const resourceLimit = readCapabilityEvidence(value.resourceLimit, 'resourceLimit')
  const provider = readCapabilityEvidence(value.provider, 'provider')
  const pricing = readCapabilityEvidence(value.pricing, 'pricing')
  if (typeof value.funding !== 'string' ||
      !CAPABILITY_FUNDING.has(value.funding as ClientCapabilityFundingEvidence) ||
      !Array.isArray(value.denialConditions)) {
    throw capabilityError('operation funding or denial evidence is invalid')
  }
  const funding = value.funding as ClientCapabilityFundingEvidence
  const denialConditions = value.denialConditions.map((condition) => {
    if (typeof condition !== 'string' ||
        !CAPABILITY_DENIALS.has(condition as ClientCapabilityDenialCondition)) {
      throw capabilityError('operation denial condition is unsupported')
    }
    return condition as ClientCapabilityDenialCondition
  })
  if (new Set(denialConditions).size !== denialConditions.length ||
      (value.outcome !== 'eligible' && value.outcome !== 'denied') ||
      permission === 'not_applicable' || permission === 'unavailable' ||
      resourceLimit === 'not_applicable' || resourceLimit === 'unavailable' ||
      (flag ? feature !== 'satisfied' : feature !== 'denied') ||
      (isAi ? provider === 'not_applicable' || pricing === 'not_applicable' || funding === 'not_applicable'
        : provider !== 'not_applicable' || pricing !== 'not_applicable' || funding !== 'not_applicable') ||
      funding === 'sufficient_for_quote' || funding === 'unavailable' ||
      (isAi && classification === 'customer' && entitlement === 'not_applicable') ||
      ((!isAi || classification === 'soveris_internal') && entitlement !== 'not_applicable')) {
    throw capabilityError('operation evidence is inconsistent')
  }
  const expected: ClientCapabilityDenialCondition[] = []
  if (permission === 'denied') expected.push('permission_denied')
  if (feature === 'denied') expected.push('feature_not_available')
  if (entitlement === 'denied') expected.push('entitlement_not_available')
  if (resourceLimit === 'denied') expected.push('limit_reached')
  if (provider === 'unavailable') expected.push('provider_unavailable')
  if (pricing === 'unavailable') expected.push('pricing_unavailable')
  if (funding === 'wallet_missing') expected.push('wallet_missing')
  if (funding === 'wallet_ineligible') expected.push('wallet_ineligible')
  if (funding === 'zero_available' || funding === 'insufficient_credits') expected.push('insufficient_credits')
  const evidenceDenials = denialConditions.filter((condition) =>
    condition !== 'transition_pending' && condition !== 'stale_capability_evidence')
  if (expected.length !== evidenceDenials.length ||
      expected.some((condition, index) => evidenceDenials[index] !== condition) ||
      (value.outcome === 'eligible') !== (denialConditions.length === 0)) {
    throw capabilityError('operation outcome and denial conditions are inconsistent')
  }
  return {
    key,
    outcome: value.outcome,
    permission,
    feature,
    entitlement,
    resourceLimit,
    provider,
    pricing,
    funding,
    denialConditions,
  }
}

export function parseClientCapabilities(text: string, expectedClientId: string): ClientCapabilities {
  const expectedClient = canonicalizeGuid(expectedClientId)
  if (!expectedClient) throw capabilityError('requested Client ID is invalid')
  const payload = parseCapabilitiesPayload(text)
  if (!hasExactKeys(payload, CAPABILITY_TOP_KEYS)) {
    throw capabilityError('payload fields do not match the closed contract')
  }
  const clientId = canonicalizeGuid(typeof payload.clientId === 'string' ? payload.clientId : undefined)
  if (!clientId || clientId !== expectedClient || payload.classificationSource !== 'back_office.clients' ||
      typeof payload.classification !== 'string' ||
      !CAPABILITY_CLASSIFICATIONS.has(payload.classification as ClientClassification) ||
      typeof payload.policySource !== 'string' ||
      !CAPABILITY_POLICY_SOURCES.has(payload.policySource as ClientCapabilityPolicySource) ||
      typeof payload.policyVersion !== 'string' || !payload.policyVersion.trim() ||
      !Array.isArray(payload.flags) || !Array.isArray(payload.limits) ||
      !Array.isArray(payload.usage) || !Array.isArray(payload.operations)) {
    throw capabilityError('source, identity, policy, or collection evidence is invalid')
  }
  const classification = payload.classification as ClientClassification
  const policySource = payload.policySource as ClientCapabilityPolicySource
  const evaluatedAt = readCapabilityInstant(payload.evaluatedAt, 'evaluatedAt')
  const nextBoundary = payload.nextBoundary === null
    ? null : readCapabilityInstant(payload.nextBoundary, 'nextBoundary')
  if (nextBoundary !== null && Date.parse(nextBoundary) <= Date.parse(evaluatedAt)) {
    throw capabilityError('nextBoundary must be later than evaluatedAt')
  }
  const subscription = parseCapabilitySubscription(payload.subscription)
  const effective = subscription?.effectiveTier !== null && subscription?.effectiveTier !== undefined
  const activeInWindow = subscription?.status === 'active' &&
    Date.parse(subscription.validFrom) <= Date.parse(evaluatedAt) &&
    (subscription.validTo === null || Date.parse(evaluatedAt) < Date.parse(subscription.validTo))
  if ((classification === 'soveris_internal' && (policySource !== 'internal' || effective)) ||
      (classification === 'customer' && policySource === 'internal') ||
      (policySource === 'customer_subscription' &&
        (!subscription || !effective || subscription.effectiveTier !== subscription.storedTier ||
         subscription.status !== 'active' || Date.parse(subscription.validFrom) > Date.parse(evaluatedAt) ||
         (subscription.validTo !== null && Date.parse(evaluatedAt) >= Date.parse(subscription.validTo)))) ||
      (policySource === 'customer_freemium' && (effective || activeInWindow)) ||
      (!subscription && policySource === 'customer_subscription')) {
    throw capabilityError('classification, policy source, and subscription are inconsistent')
  }

  const flags = payload.flags.map((value) => {
    if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_FLAG_KEYS) ||
        typeof value.key !== 'string' || !CAPABILITY_KEY_SET.has(value.key) ||
        typeof value.enabled !== 'boolean') throw capabilityError('flag evidence is invalid')
    return { key: value.key as ClientCapabilityKey, enabled: value.enabled }
  })
  const flagMap = new Map(flags.map((flag) => [flag.key, flag.enabled]))
  if (flags.length !== CLIENT_CAPABILITY_KEYS.length || flagMap.size !== flags.length ||
      CLIENT_CAPABILITY_KEYS.some((key) => !flagMap.has(key))) {
    throw capabilityError('flag keys must be the unique closed capability set')
  }
  if (flagMap.get('ai_source_ingestion') !== false ||
      (classification === 'soveris_internal' && CLIENT_CAPABILITY_KEYS
        .filter((key) => key !== 'ai_source_ingestion').some((key) => flagMap.get(key) !== true))) {
    throw capabilityError('registered delivered feature evidence is inconsistent')
  }

  const parseLimit = (value: unknown, measured: boolean): ClientCapabilityLimit | ClientCapabilityUsage => {
    if (!isRecord(value) || !hasExactKeys(value, measured ? CAPABILITY_USAGE_KEYS : CAPABILITY_LIMIT_KEYS) ||
        typeof value.key !== 'string' || !CAPABILITY_LIMIT_UNITS.has(value.key as ClientCapabilityLimitKey)) {
      throw capabilityError('limit or usage evidence is invalid')
    }
    const key = value.key as ClientCapabilityLimitKey
    const unit = CAPABILITY_LIMIT_UNITS.get(key)!
    if (value.unit !== unit) throw capabilityError('limit or usage unit is invalid')
    const base = { key, unit, value: readCapabilityInt64(value.value, measured ? 'usage.value' : 'limit.value', !measured) }
    if (!measured) return base
    const measuredAt = readCapabilityInstant(value.measuredAt, 'measuredAt')
    if (Date.parse(measuredAt) > Date.parse(evaluatedAt)) throw capabilityError('usage occurs after evaluation')
    return { ...base, measuredAt }
  }
  const limits = payload.limits.map((value) => parseLimit(value, false) as ClientCapabilityLimit)
  const usage = payload.usage.map((value) => parseLimit(value, true) as ClientCapabilityUsage)
  for (const entries of [limits, usage]) {
    const keys = new Set(entries.map((entry) => entry.key))
    if (entries.length !== CAPABILITY_LIMIT_UNITS.size || keys.size !== entries.length ||
        [...CAPABILITY_LIMIT_UNITS.keys()].some((key) => !keys.has(key))) {
      throw capabilityError('limit and usage keys must be complete and unique')
    }
  }
  const operations = payload.operations.map((value) => {
    const key = isRecord(value) && typeof value.key === 'string'
      ? value.key as ClientCapabilityKey : '' as ClientCapabilityKey
    return parseCapabilityOperation(value, classification, flagMap.get(key) ?? false)
  })
  const operationKeys = new Set(operations.map((operation) => operation.key))
  if (operations.length !== CLIENT_CAPABILITY_KEYS.length || operationKeys.size !== operations.length ||
      CLIENT_CAPABILITY_KEYS.some((key) => !operationKeys.has(key))) {
    throw capabilityError('operation keys must be the unique closed capability set')
  }
  return {
    clientId,
    classificationSource: 'back_office.clients',
    classification,
    classificationRevision: readCapabilityInt64(payload.classificationRevision, 'classificationRevision'),
    policySource,
    policyVersion: payload.policyVersion,
    subscription,
    flags,
    limits,
    usage,
    operations,
    evaluatedAt,
    nextBoundary,
  }
}

export async function getClientCapabilities(
  clientId: string,
  signal?: AbortSignal
): Promise<ClientCapabilities> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw capabilityError('requested Client ID is invalid')
  const response = await apiClient.getApiRoot<string>(
    `/api/backoffice/clients/${canonicalClientId}/capabilities`,
    { responseType: 'text', signal }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw capabilityError('response is not valid capability JSON text')
  }
  return parseClientCapabilities(response.data, canonicalClientId)
}

function ledgerContractError(reason: string): BillingLedgerContractError {
  return new BillingLedgerContractError(reason)
}

function readLedgerGuid(value: unknown, nullable: false): string
function readLedgerGuid(value: unknown, nullable: true): string | null
function readLedgerGuid(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  const guid = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!guid) throw ledgerContractError('an identifier is invalid')
  return guid
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw ledgerContractError('a nullable text field is invalid')
  return value
}

function readLedgerDecimal(value: unknown, field: 'amount' | 'balanceAfter'): string {
  if (!isLosslessNumber(value)) throw ledgerContractError(`${field} must be a JSON number`)
  const exact = value.toString()
  if (!DECIMAL_18_4_PATTERN.test(exact)) {
    throw ledgerContractError(`${field} is outside the DECIMAL(18,4) contract`)
  }
  return exact
}

function isLexicalZero(value: string): boolean {
  return /^-?0(?:\.0+)?$/.test(value)
}

function validateAmountSign(type: BillingLedgerTransactionType, amount: string): void {
  if (isLexicalZero(amount)) throw ledgerContractError('amount must be nonzero')
  const negative = amount.startsWith('-')
  const requiresNegative = type === 'reservation' || type === 'consumption'
  const allowsEither = type === 'manual_adjustment' || type === 'reversal'
  if (!allowsEither && negative !== requiresNegative) {
    throw ledgerContractError('amount sign does not match transaction type')
  }
}

function readLedgerInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UTC_OFFSET_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw ledgerContractError(`${field} must be a UTC DateTimeOffset`)
  }
  return value
}

function parseLedgerItem(value: unknown, expectedCreditAccountId?: string): BillingLedgerItem {
  if (!isRecord(value) || !hasExactKeys(value, LEDGER_ITEM_KEYS)) {
    throw ledgerContractError('item fields do not match the closed contract')
  }
  const transactionType = typeof value.transactionType === 'string' &&
    LEDGER_TRANSACTION_TYPES.has(value.transactionType as BillingLedgerTransactionType)
    ? value.transactionType as BillingLedgerTransactionType
    : null
  if (!transactionType) throw ledgerContractError('transaction type is unsupported')

  const creditAccountId = readLedgerGuid(value.creditAccountId, false)
  if (expectedCreditAccountId && creditAccountId !== expectedCreditAccountId) {
    throw ledgerContractError('item does not match the filtered Credit account')
  }
  const amount = readLedgerDecimal(value.amount, 'amount')
  validateAmountSign(transactionType, amount)
  const balanceAfter = readLedgerDecimal(value.balanceAfter, 'balanceAfter')
  if (balanceAfter.startsWith('-')) throw ledgerContractError('balanceAfter must be non-negative')

  return {
    ledgerId: readLedgerGuid(value.ledgerId, false),
    creditAccountId,
    jobId: readLedgerGuid(value.jobId, true),
    reservationId: readLedgerGuid(value.reservationId, true),
    adjustmentId: readLedgerGuid(value.adjustmentId, true),
    operationId: readLedgerGuid(value.operationId, false),
    transactionType,
    amount,
    balanceAfter,
    ruleId: readLedgerGuid(value.ruleId, true),
    ruleVersion: readNullableString(value.ruleVersion),
    actorUserId: readLedgerGuid(value.actorUserId, true),
    reason: readNullableString(value.reason),
    createdAt: readLedgerInstant(value.createdAt, 'createdAt'),
  }
}

export function parseBillingLedgerPage(text: string, expectedCreditAccountId?: string): BillingLedgerPage {
  const expectedAccount = expectedCreditAccountId === undefined
    ? undefined
    : canonicalizeGuid(expectedCreditAccountId) ?? (() => { throw ledgerContractError('filtered Credit account is invalid') })()
  let payload: unknown
  try {
    payload = parse(text)
  } catch {
    throw ledgerContractError('response is not valid JSON')
  }
  if (!isRecord(payload) || !hasExactKeys(payload, LEDGER_PAGE_KEYS)) {
    throw ledgerContractError('page fields do not match the closed contract')
  }
  if (!Array.isArray(payload.items)) throw ledgerContractError('items must be an array')
  const asOf = readLedgerInstant(payload.asOf, 'asOf')
  const nextCursor = payload.nextCursor === null
    ? null
    : typeof payload.nextCursor === 'string' && payload.nextCursor.trim()
      ? payload.nextCursor
      : (() => { throw ledgerContractError('nextCursor is invalid') })()
  const items = payload.items.map((item) => parseLedgerItem(item, expectedAccount))
  if (new Set(items.map((item) => item.ledgerId)).size !== items.length) {
    throw ledgerContractError('page contains a duplicate ledger row')
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || Date.parse(item.createdAt) > Date.parse(asOf)) {
      throw ledgerContractError('item occurs after the page watermark')
    }
    const previous = items[index - 1]
    if (previous) {
      const timeOrder = Date.parse(previous.createdAt) - Date.parse(item.createdAt)
      if (timeOrder < 0 || (timeOrder === 0 && previous.ledgerId.localeCompare(item.ledgerId) < 0)) {
        throw ledgerContractError('items are not in server order')
      }
    }
  }
  return { items, asOf, nextCursor }
}

function appendInitialFilters(params: URLSearchParams, filters: BillingLedgerFilters): void {
  const entries: Array<[keyof BillingLedgerFilters, string]> = [
    ['creditAccountId', filters.creditAccountId ?? ''],
    ['from', filters.from ?? ''],
    ['to', filters.to ?? ''],
    ['transactionType', filters.transactionType ?? ''],
    ['actorUserId', filters.actorUserId ?? ''],
    ['jobId', filters.jobId ?? ''],
    ['reservationId', filters.reservationId ?? ''],
  ]
  for (const [key, value] of entries) if (value) params.set(key, value)
  if (filters.pageSize !== undefined) params.set('pageSize', String(filters.pageSize))
}

export async function getBillingLedgerPage(
  clientId: string,
  request: BillingLedgerPageRequest,
  signal?: AbortSignal
): Promise<BillingLedgerPage> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw ledgerContractError('requested Client ID is invalid')
  const params = new URLSearchParams()
  let expectedAccount: string | undefined
  if (typeof request.cursor === 'string') {
    if (!request.cursor.trim()) throw ledgerContractError('cursor is invalid')
    params.set('cursor', request.cursor)
  } else {
    appendInitialFilters(params, request.filters)
    expectedAccount = request.filters.creditAccountId
  }
  const query = params.toString()
  const response = await apiClient.getApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/ledger${query ? `?${query}` : ''}`,
    { responseType: 'text', signal }
  )
  if (typeof response.data !== 'string') throw ledgerContractError('response must be JSON text')
  return parseBillingLedgerPage(response.data, expectedAccount)
}

const EXPORT_FILTER_KEYS = [
  'actorUserId', 'creditAccountId', 'from', 'jobId', 'reservationId', 'to', 'transactionType',
] as const
const EXPORT_ACCEPTED_KEYS = ['asOf', 'clientId', 'exportId', 'filters', 'requestedAt', 'status'] as const
const EXPORT_STATUS_KEYS = [
  'artifactExpiresAt', 'asOf', 'byteSize', 'clientId', 'exportId', 'failureCode', 'filters',
  'reference', 'referenceExpiresAt', 'requestedAt', 'rowCount', 'status',
] as const
const EXPORT_STATUSES = new Set<BillingLedgerExportStatus>([
  'pending', 'processing', 'completed', 'failed', 'expired',
])
const EXPORT_FAILURE_CODES = new Set<BillingLedgerExportFailureCode>([
  'generation_failed', 'artifact_store_failed', 'completion_failed',
])

function exportContractError(reason: string): BillingLedgerExportContractError {
  return new BillingLedgerExportContractError(reason)
}

function readExportInstant(value: unknown, nullable: false): string
function readExportInstant(value: unknown, nullable: true): string | null
function readExportInstant(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !UTC_OFFSET_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw exportContractError('a timestamp is invalid')
  }
  return value
}

function readExportGuid(value: unknown, nullable: false): string
function readExportGuid(value: unknown, nullable: true): string | null
function readExportGuid(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  const valueAsGuid = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!valueAsGuid) throw exportContractError('an identifier is invalid')
  return valueAsGuid
}

function readExportId(value: unknown): string {
  const exportId = readExportGuid(value, false)
  if (exportId[14] !== '7' || !/[89ab]/.test(exportId[19] ?? '')) {
    throw exportContractError('the export identifier is invalid')
  }
  return exportId
}

function parseExportFilters(value: unknown): BillingLedgerExportFilters {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_FILTER_KEYS)) {
    throw exportContractError('filter fields do not match the closed contract')
  }
  const transactionType = value.transactionType === null
    ? null
    : typeof value.transactionType === 'string' &&
      LEDGER_TRANSACTION_TYPES.has(value.transactionType as BillingLedgerTransactionType)
      ? value.transactionType as BillingLedgerTransactionType
      : (() => { throw exportContractError('the transaction type is invalid') })()
  const from = readExportInstant(value.from, true)
  const to = readExportInstant(value.to, true)
  if (from && to && Date.parse(from) >= Date.parse(to)) {
    throw exportContractError('the filter interval is invalid')
  }
  return {
    creditAccountId: readExportGuid(value.creditAccountId, true),
    from,
    to,
    transactionType,
    actorUserId: readExportGuid(value.actorUserId, true),
    jobId: readExportGuid(value.jobId, true),
    reservationId: readExportGuid(value.reservationId, true),
  }
}

export function normalizeLedgerExportFilters(filters: BillingLedgerFilters): BillingLedgerExportFilters {
  return parseExportFilters({
    creditAccountId: filters.creditAccountId ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    transactionType: filters.transactionType ?? null,
    actorUserId: filters.actorUserId ?? null,
    jobId: filters.jobId ?? null,
    reservationId: filters.reservationId ?? null,
  })
}

function exportFiltersMatch(left: BillingLedgerExportFilters, right: BillingLedgerExportFilters): boolean {
  return EXPORT_FILTER_KEYS.every((key) => left[key] === right[key])
}

function parseExportJson(text: string): Record<string, unknown> {
  let payload: unknown
  try {
    payload = parse(text)
  } catch {
    throw exportContractError('response is not valid JSON')
  }
  if (!isRecord(payload)) throw exportContractError('payload must be an object')
  return payload
}

export function parseBillingLedgerExportAccepted(
  text: string,
  expectedClientId: string,
  expectedFilters: BillingLedgerExportFilters
): BillingLedgerExportAccepted {
  const payload = parseExportJson(text)
  if (!hasExactKeys(payload, EXPORT_ACCEPTED_KEYS)) {
    throw exportContractError('accepted fields do not match the closed contract')
  }
  const clientId = readExportGuid(payload.clientId, false)
  const canonicalExpectedClient = canonicalizeGuid(expectedClientId)
  const filters = parseExportFilters(payload.filters)
  const requestedAt = readExportInstant(payload.requestedAt, false)
  const asOf = readExportInstant(payload.asOf, false)
  if (!canonicalExpectedClient || clientId !== canonicalExpectedClient ||
      !exportFiltersMatch(filters, expectedFilters)) {
    throw exportContractError('accepted scope does not match the request')
  }
  if (payload.status !== 'pending' || requestedAt !== asOf) {
    throw exportContractError('accepted lifecycle state is invalid')
  }
  return {
    exportId: readExportId(payload.exportId), clientId, filters, requestedAt, asOf, status: 'pending',
  }
}

function readInt64Lexeme(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw exportContractError('an Int64 metadata field is invalid')
  }
  const lexeme = value.toString()
  if (BigInt(lexeme) > INT64_MAX) {
    throw exportContractError('an Int64 metadata field is invalid')
  }
  return lexeme
}

function validateStatusLifecycle(metadata: BillingLedgerExportStatusMetadata, reference: BillingLedgerExportReference | null): void {
  const emptyArtifact = metadata.rowCount === null && metadata.byteSize === null && metadata.artifactExpiresAt === null
  if (metadata.status === 'pending' || metadata.status === 'processing') {
    if (!emptyArtifact || metadata.failureCode !== null || reference) throw exportContractError('lifecycle metadata is invalid')
  } else if (metadata.status === 'failed') {
    if (!emptyArtifact || metadata.failureCode === null || reference) throw exportContractError('lifecycle metadata is invalid')
  } else {
    if (metadata.rowCount === null || metadata.byteSize === null || metadata.artifactExpiresAt === null ||
        metadata.failureCode !== null || (metadata.status === 'expired' && reference)) {
      throw exportContractError('lifecycle metadata is invalid')
    }
  }
}

export function parseBillingLedgerExportStatus(
  text: string,
  attempt: BillingLedgerExportAttempt
): BillingLedgerExportStatusResult {
  const payload = parseExportJson(text)
  if (!hasExactKeys(payload, EXPORT_STATUS_KEYS)) {
    throw exportContractError('status fields do not match the closed contract')
  }
  const status = typeof payload.status === 'string' && EXPORT_STATUSES.has(payload.status as BillingLedgerExportStatus)
    ? payload.status as BillingLedgerExportStatus
    : (() => { throw exportContractError('status is invalid') })()
  const failureCode = payload.failureCode === null
    ? null
    : typeof payload.failureCode === 'string' && EXPORT_FAILURE_CODES.has(payload.failureCode as BillingLedgerExportFailureCode)
      ? payload.failureCode as BillingLedgerExportFailureCode
      : (() => { throw exportContractError('failure classification is invalid') })()
  const filters = parseExportFilters(payload.filters)
  const metadata: BillingLedgerExportStatusMetadata = {
    exportId: readExportId(payload.exportId),
    clientId: readExportGuid(payload.clientId, false),
    filters,
    requestedAt: readExportInstant(payload.requestedAt, false),
    asOf: readExportInstant(payload.asOf, false),
    status,
    rowCount: readInt64Lexeme(payload.rowCount, true),
    byteSize: readInt64Lexeme(payload.byteSize, true),
    artifactExpiresAt: readExportInstant(payload.artifactExpiresAt, true),
    failureCode,
  }
  if (metadata.exportId !== attempt.exportId || metadata.clientId !== attempt.clientId ||
      metadata.requestedAt !== attempt.requestedAt || metadata.asOf !== attempt.asOf ||
      !exportFiltersMatch(metadata.filters, attempt.filters)) {
    throw exportContractError('status scope does not match the accepted export')
  }
  const hasReference = payload.reference !== null || payload.referenceExpiresAt !== null
  let reference: BillingLedgerExportReference | null = null
  if (hasReference) {
    if (typeof payload.reference !== 'string' || !payload.reference.trim() || payload.reference.length > 4096) {
      throw exportContractError('reference eligibility is invalid')
    }
    reference = { value: payload.reference, expiresAt: readExportInstant(payload.referenceExpiresAt, false) }
  }
  validateStatusLifecycle(metadata, reference)
  if (reference && metadata.artifactExpiresAt &&
      Date.parse(reference.expiresAt) > Date.parse(metadata.artifactExpiresAt)) {
    throw exportContractError('reference eligibility is invalid')
  }
  return { metadata, reference }
}

function requestFilterObject(filters: BillingLedgerExportFilters): Record<string, string> {
  const body: Record<string, string> = {}
  for (const key of EXPORT_FILTER_KEYS) {
    const value = filters[key]
    if (value !== null) body[key] = value
  }
  return body
}

export async function requestBillingLedgerExport(
  clientId: string,
  filters: BillingLedgerFilters,
  signal?: AbortSignal
): Promise<BillingLedgerExportAccepted> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw exportContractError('requested Client ID is invalid')
  const normalizedFilters = normalizeLedgerExportFilters(filters)
  const response = await apiClient.postApiRoot<string>('/api/audit/exports', {
    clientId: canonicalClientId,
    filters: requestFilterObject(normalizedFilters),
  }, { responseType: 'text', signal })
  if (response.status !== 202 || typeof response.data !== 'string') {
    throw exportContractError('accepted response is invalid')
  }
  return parseBillingLedgerExportAccepted(response.data, canonicalClientId, normalizedFilters)
}

export async function getBillingLedgerExportStatus(
  attempt: BillingLedgerExportAttempt,
  signal?: AbortSignal
): Promise<BillingLedgerExportStatusResult> {
  const response = await apiClient.getApiRoot<string>(`/api/audit/exports/${attempt.exportId}`, {
    responseType: 'text', signal,
  })
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw exportContractError('status response is invalid')
  }
  return parseBillingLedgerExportStatus(response.data, attempt)
}

export async function redeemBillingLedgerExport(
  attempt: BillingLedgerExportAttempt,
  reference: BillingLedgerExportReference,
  signal?: AbortSignal
): Promise<Blob> {
  if (!reference.value.trim() || reference.value.length > 4096 || Date.parse(reference.expiresAt) <= Date.now()) {
    throw exportContractError('reference eligibility is invalid')
  }
  const response = await apiClient.postApiRoot<Blob>(
    `/api/audit/exports/${attempt.exportId}/redemptions`,
    { reference: reference.value },
    { responseType: 'blob', signal }
  )
  const isBlob = response.data instanceof Blob
  const contentType = String(response.headers?.['content-type'] ?? (isBlob ? response.data.type : '')).toLowerCase()
  const mediaType = contentType.split(';', 1)[0]?.trim()
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const expectedFilename = `ledger-export-${attempt.exportId}.csv`
  if (response.status !== 200 || !isBlob || mediaType !== 'text/csv' ||
      (disposition && !disposition.includes(expectedFilename))) {
    throw exportContractError('download response is invalid')
  }
  return response.data
}

const ENTITLEMENT_KEYS = ['featureFlags', 'rateLimits', 'schemaVersion'] as const
const RATE_LIMIT_KEYS = ['concurrentAiOperations', 'requestsPerMinute'] as const
const FEATURE_FLAG_KEYS = ['contentGeneration', 'imageGeneration'] as const
const SUBSCRIPTION_REQUIRED_KEYS = [
  'billingCycleAnchor', 'changeEffectivePolicy', 'clientId', 'createdAt',
  'creationOperationId', 'cycleCreditAmount', 'entitlements', 'planName',
  'planTermsOperationId', 'prorationPolicy', 'status', 'subscriptionId',
  'subscriptionTier', 'tierRevision', 'unusedCreditPolicy', 'updatedAt', 'validFrom', 'validTo',
] as const
const SUBSCRIPTION_OPTIONAL_KEYS = ['immediateChangeContext', 'pendingImmediateDebit'] as const
const GRANT_KEYS = [
  'createdAt', 'creditAmount', 'cycleEnd', 'cycleStart', 'entitlementsSnapshot',
  'grantId', 'grantOperationId', 'grantType', 'ledgerEntryId', 'planNameSnapshot',
  'planTermsOperationId', 'subscriptionId', 'subscriptionTierSnapshot', 'tierRevisionSnapshot',
] as const
const GRANT_HISTORY_KEYS = ['historyAsOf', 'items', 'nextCursor'] as const
const STATE_REQUIRED_KEYS = [
  'clientId', 'current', 'grantHistory', 'pendingChange', 'stateAsOf', 'subscriptionHistory',
] as const
const STATE_OPTIONAL_KEYS = [
  'immediateChangeContext', 'pendingImmediateDebit', 'pendingTierChange',
] as const
const PENDING_CHANGE_KEYS = [
  'changeEffectivePolicy', 'cycleCreditAmount', 'effectiveCycleEnd', 'effectiveCycleIndex',
  'effectiveCycleStart', 'entitlements', 'planChangeOperationId', 'planName',
  'prorationPolicy', 'scheduledAt', 'schemaVersion', 'unusedCreditPolicy',
] as const
const PENDING_TIER_CHANGE_KEYS = [
  'effectiveCycleEnd', 'effectiveCycleIndex', 'effectiveCycleStart', 'effectivePolicy',
  'expectedTierRevision', 'operationId', 'reason', 'scheduledAt', 'schemaVersion',
  'subscriptionTier',
] as const
const IMMEDIATE_DEBIT_REQUIRED_KEYS = [
  'appliedDebit', 'createdAt', 'originalDebit', 'outstandingDebit',
  'planChangeOperationId', 'policyVersion',
] as const
const IMMEDIATE_DEBIT_OPTIONAL_KEYS = [
  'lastAppliedAt', 'lastAppliedCycleIndex', 'lastAppliedCycleStart',
] as const
const IMMEDIATE_CONTEXT_REQUIRED_KEYS = ['cycleEnd', 'cycleIndex', 'cycleStart'] as const
const IMMEDIATE_CONTEXT_OPTIONAL_KEYS = ['grantOperationId'] as const
const CREATION_SUBSCRIPTION_KEYS = [
  'billingCycleAnchor', 'changeEffectivePolicy', 'clientId', 'creationOperationId',
  'cycleCreditAmount', 'entitlements', 'planName', 'planTermsOperationId',
  'prorationPolicy', 'status', 'subscriptionId', 'subscriptionTier', 'tierRevision',
  'unusedCreditPolicy', 'validFrom', 'validTo',
] as const
const CREATION_GRANT_KEYS = [
  'creditAmount', 'cycleEnd', 'cycleStart', 'entitlementsSnapshot', 'grantId',
  'grantOperationId', 'grantType', 'ledgerEntryId', 'planNameSnapshot', 'planTermsOperationId',
  'subscriptionTierSnapshot', 'tierRevisionSnapshot',
] as const
const CREATION_ACCOUNT_KEYS = [
  'activelyReservedAmount', 'asOf', 'availableBalance', 'clientId',
  'creditAccountId', 'ownedBalance', 'status',
] as const
const CREATION_RECEIPT_KEYS = ['account', 'created', 'initialGrant', 'subscription'] as const
const CREATION_REQUEST_KEYS = [
  'changeEffectivePolicy', 'creationOperationId', 'cycleCreditAmount', 'entitlements',
  'planName', 'prorationPolicy', 'subscriptionTier', 'unusedCreditPolicy', 'validFrom', 'validTo',
] as const
const SUBSCRIPTION_STATUSES = new Set(['active', 'paused', 'cancelled', 'expired'])
const SUBSCRIPTION_TIERS = new Set<BillingSubscriptionTier>([
  'freemium', 'basic', 'brand', 'brand_premium',
])
const CHANGE_POLICIES = new Set<BillingSubscriptionChangePolicy>(['immediate', 'next_billing_cycle'])
const PRORATION_POLICIES = new Set<BillingSubscriptionProrationPolicy>(['none', 'replace', 'prorate'])
const GRANT_TYPES = new Set(['billing_cycle', 'operator_override'])
const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUBSCRIPTION_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|\+00:00)$/
const LIFECYCLE_REQUEST_KEYS = ['action', 'expectedStatus', 'lifecycleOperationId', 'reason'] as const
const LIFECYCLE_RECEIPT_KEYS = [
  'action', 'clientId', 'effectiveAt', 'lifecycleOperationId', 'operationAsOf',
  'previousStatus', 'reason', 'status', 'subscriptionId',
] as const
const LIFECYCLE_ACTIONS = new Set<BillingSubscriptionLifecycleAction>([
  'pause', 'reactivate', 'cancel', 'expire',
])

export class BillingSubscriptionContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing subscription: ${reason}`)
    this.name = 'BillingSubscriptionContractError'
  }
}

function subscriptionContractError(reason: string): BillingSubscriptionContractError {
  return new BillingSubscriptionContractError(reason)
}

function hasRequiredAndAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key))
}

function readSubscriptionGuid(value: unknown, field: string): string {
  const guid = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!guid) throw subscriptionContractError(`${field} must be a GUID`)
  return guid
}

function readSubscriptionUuidV7(value: unknown, field: string): string {
  const guid = readSubscriptionGuid(value, field)
  if (!UUID_V7_PATTERN.test(guid)) throw subscriptionContractError(`${field} must be UUIDv7`)
  return guid
}

function readSubscriptionInstant(value: unknown, field: string): string {
  const match = typeof value === 'string' ? SUBSCRIPTION_INSTANT_PATTERN.exec(value) : null
  if (!match || Number.isNaN(Date.parse(value as string))) {
    throw subscriptionContractError(`${field} must be a UTC instant`)
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const check = new Date(0)
  check.setUTCFullYear(year!, month! - 1, day!)
  check.setUTCHours(hour!, minute!, second!, 0)
  if (year! < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month! - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    throw subscriptionContractError(`${field} must be a UTC instant`)
  }
  return value as string
}

function readSubscriptionDecimal(value: unknown, field: string, positive = false): string {
  if (!isLosslessNumber(value)) throw subscriptionContractError(`${field} must be a JSON number`)
  const lexeme = value.toString()
  const pattern = positive ? POSITIVE_DECIMAL_PATTERN : DECIMAL_18_4_PATTERN
  if (!pattern.test(lexeme) || (positive && /^0(?:\.0+)?$/.test(lexeme))) {
    throw subscriptionContractError(`${field} is outside the DECIMAL(18,4) contract`)
  }
  return lexeme
}

function readSubscriptionInteger(value: unknown, field: string, min: number, max: number): number {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw subscriptionContractError(`${field} must be an integer`)
  }
  const number = Number(value.toString())
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw subscriptionContractError(`${field} is outside its supported range`)
  }
  return number
}

function readSubscriptionPlanName(value: unknown, field = 'planName'): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
      value.includes('\0') || value.trim() !== value) {
    throw subscriptionContractError(`${field} is invalid`)
  }
  return value
}

function readSubscriptionTier(value: unknown, field = 'subscriptionTier'): BillingSubscriptionTier {
  if (typeof value !== 'string' || !SUBSCRIPTION_TIERS.has(value as BillingSubscriptionTier)) {
    throw subscriptionContractError(`${field} is unsupported`)
  }
  return value as BillingSubscriptionTier
}

function readTierRevision(value: unknown, field = 'tierRevision'): string {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) {
    throw subscriptionContractError(`${field} must be a non-negative Int64`)
  }
  const lexeme = value.toString()
  if (BigInt(lexeme) > INT64_MAX) {
    throw subscriptionContractError(`${field} must be a non-negative Int64`)
  }
  return lexeme
}

function validateTierRevisionString(value: unknown, field = 'tierRevision'): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) > INT64_MAX) {
    throw subscriptionContractError(`${field} must be a non-negative Int64 string`)
  }
  return value
}

function parseEntitlements(value: unknown): BillingEntitlementsV1 {
  if (!isRecord(value) || !hasExactKeys(value, ENTITLEMENT_KEYS) ||
      !isRecord(value.rateLimits) || !hasExactKeys(value.rateLimits, RATE_LIMIT_KEYS) ||
      !isRecord(value.featureFlags) || !hasExactKeys(value.featureFlags, FEATURE_FLAG_KEYS)) {
    throw subscriptionContractError('entitlements do not match the closed v1 contract')
  }
  const schemaVersion = readSubscriptionInteger(value.schemaVersion, 'schemaVersion', 1, 1)
  const requestsPerMinute = readSubscriptionInteger(
    value.rateLimits.requestsPerMinute, 'requestsPerMinute', 1, 10_000
  )
  const concurrentAiOperations = readSubscriptionInteger(
    value.rateLimits.concurrentAiOperations, 'concurrentAiOperations', 1, 1_000
  )
  const contentGeneration = value.featureFlags.contentGeneration
  const imageGeneration = value.featureFlags.imageGeneration
  if (typeof contentGeneration !== 'boolean' || typeof imageGeneration !== 'boolean' ||
      (!contentGeneration && !imageGeneration)) {
    throw subscriptionContractError('feature flags are invalid')
  }
  return {
    schemaVersion: schemaVersion as 1,
    rateLimits: { requestsPerMinute, concurrentAiOperations },
    featureFlags: { contentGeneration, imageGeneration },
  }
}

function readChangePolicy(value: unknown): BillingSubscriptionChangePolicy {
  if (typeof value !== 'string' || !CHANGE_POLICIES.has(value as BillingSubscriptionChangePolicy)) {
    throw subscriptionContractError('changeEffectivePolicy is unsupported')
  }
  return value as BillingSubscriptionChangePolicy
}

function readProrationPolicy(value: unknown): BillingSubscriptionProrationPolicy {
  if (typeof value !== 'string' || !PRORATION_POLICIES.has(value as BillingSubscriptionProrationPolicy)) {
    throw subscriptionContractError('prorationPolicy is unsupported')
  }
  return value as BillingSubscriptionProrationPolicy
}

function parseUnsupported(value: Record<string, unknown>): BillingSubscriptionUnsupportedView | null {
  return hasExactKeys(value, ['status']) && value.status === 'unsupported'
    ? { status: 'unsupported' }
    : null
}

function parsePendingChange(
  value: unknown
): BillingSubscriptionPendingChange | BillingSubscriptionUnsupportedView | null {
  if (value === null) return null
  if (!isRecord(value)) throw subscriptionContractError('pendingChange must be an object or null')
  const unsupported = parseUnsupported(value)
  if (unsupported) return unsupported
  if (!hasExactKeys(value, PENDING_CHANGE_KEYS)) {
    throw subscriptionContractError('pendingChange fields do not match the closed contract')
  }
  return {
    schemaVersion: readSubscriptionInteger(value.schemaVersion, 'pending schemaVersion', 1, 2_147_483_647),
    planChangeOperationId: readSubscriptionUuidV7(value.planChangeOperationId, 'planChangeOperationId'),
    planName: readSubscriptionPlanName(value.planName, 'pending planName'),
    cycleCreditAmount: readSubscriptionDecimal(value.cycleCreditAmount, 'pending cycleCreditAmount', true),
    entitlements: parseEntitlements(value.entitlements),
    changeEffectivePolicy: readChangePolicy(value.changeEffectivePolicy),
    prorationPolicy: readProrationPolicy(value.prorationPolicy),
    unusedCreditPolicy: value.unusedCreditPolicy === 'rollover'
      ? 'rollover' : (() => { throw subscriptionContractError('unusedCreditPolicy is unsupported') })(),
    effectiveCycleIndex: readSubscriptionInteger(value.effectiveCycleIndex, 'effectiveCycleIndex', 1, 2_147_483_647),
    effectiveCycleStart: readSubscriptionInstant(value.effectiveCycleStart, 'effectiveCycleStart'),
    effectiveCycleEnd: readSubscriptionInstant(value.effectiveCycleEnd, 'effectiveCycleEnd'),
    scheduledAt: readSubscriptionInstant(value.scheduledAt, 'scheduledAt'),
  }
}

function readTierChangeReason(value: unknown): string {
  if (typeof value !== 'string' || /^\p{White_Space}|\p{White_Space}$/u.test(value)) {
    throw subscriptionContractError('tier-change reason is invalid')
  }
  let count = 0
  for (const scalar of value) {
    if (/\p{Cc}/u.test(scalar)) throw subscriptionContractError('tier-change reason is invalid')
    count += 1
  }
  if (count < 1 || count > 512) throw subscriptionContractError('tier-change reason is invalid')
  return value
}

function parsePendingTierChange(value: unknown): BillingSubscriptionPendingTierChange {
  if (!isRecord(value) || !hasExactKeys(value, PENDING_TIER_CHANGE_KEYS)) {
    throw subscriptionContractError('pendingTierChange fields do not match the closed contract')
  }
  const effectiveCycleStart = readSubscriptionInstant(
    value.effectiveCycleStart, 'pending tier effectiveCycleStart'
  )
  const effectiveCycleEnd = readSubscriptionInstant(
    value.effectiveCycleEnd, 'pending tier effectiveCycleEnd'
  )
  const scheduledAt = readSubscriptionInstant(value.scheduledAt, 'pending tier scheduledAt')
  if (value.effectivePolicy !== 'next_billing_cycle' ||
      compareInstants(scheduledAt, effectiveCycleStart) >= 0 ||
      compareInstants(effectiveCycleStart, effectiveCycleEnd) >= 0) {
    throw subscriptionContractError('pendingTierChange timing is inconsistent')
  }
  return {
    schemaVersion: readSubscriptionInteger(value.schemaVersion, 'pending tier schemaVersion', 1, 1) as 1,
    operationId: readSubscriptionUuidV7(value.operationId, 'pending tier operationId'),
    subscriptionTier: readSubscriptionTier(value.subscriptionTier, 'pending subscriptionTier'),
    expectedTierRevision: readTierRevision(value.expectedTierRevision, 'expectedTierRevision'),
    effectivePolicy: 'next_billing_cycle',
    effectiveCycleIndex: readSubscriptionInteger(
      value.effectiveCycleIndex, 'pending tier effectiveCycleIndex', 1, 2_147_483_647
    ),
    effectiveCycleStart,
    effectiveCycleEnd,
    scheduledAt,
    reason: readTierChangeReason(value.reason),
  }
}

function parseImmediateDebit(
  value: unknown
): BillingSubscriptionImmediateDebit | BillingSubscriptionUnsupportedView {
  if (!isRecord(value)) throw subscriptionContractError('pendingImmediateDebit must be an object')
  const unsupported = parseUnsupported(value)
  if (unsupported) return unsupported
  if (!hasRequiredAndAllowedKeys(value, IMMEDIATE_DEBIT_REQUIRED_KEYS, IMMEDIATE_DEBIT_OPTIONAL_KEYS)) {
    throw subscriptionContractError('pendingImmediateDebit fields do not match the closed contract')
  }
  const result: BillingSubscriptionImmediateDebit = {
    planChangeOperationId: readSubscriptionUuidV7(value.planChangeOperationId, 'planChangeOperationId'),
    outstandingDebit: readSubscriptionDecimal(value.outstandingDebit, 'outstandingDebit', true),
    policyVersion: typeof value.policyVersion === 'string' && value.policyVersion.length > 0
      ? value.policyVersion : (() => { throw subscriptionContractError('policyVersion is invalid') })(),
    originalDebit: readSubscriptionDecimal(value.originalDebit, 'originalDebit', true),
    appliedDebit: readSubscriptionDecimal(value.appliedDebit, 'appliedDebit'),
    createdAt: readSubscriptionInstant(value.createdAt, 'createdAt'),
  }
  if ('lastAppliedAt' in value) result.lastAppliedAt = readSubscriptionInstant(value.lastAppliedAt, 'lastAppliedAt')
  if ('lastAppliedCycleIndex' in value) {
    result.lastAppliedCycleIndex = readSubscriptionInteger(value.lastAppliedCycleIndex, 'lastAppliedCycleIndex', 0, 2_147_483_647)
  }
  if ('lastAppliedCycleStart' in value) {
    result.lastAppliedCycleStart = readSubscriptionInstant(value.lastAppliedCycleStart, 'lastAppliedCycleStart')
  }
  return result
}

function parseImmediateContext(
  value: unknown
): BillingSubscriptionImmediateContext | BillingSubscriptionUnsupportedView {
  if (!isRecord(value)) throw subscriptionContractError('immediateChangeContext must be an object')
  const unsupported = parseUnsupported(value)
  if (unsupported) return unsupported
  if (!hasRequiredAndAllowedKeys(value, IMMEDIATE_CONTEXT_REQUIRED_KEYS, IMMEDIATE_CONTEXT_OPTIONAL_KEYS)) {
    throw subscriptionContractError('immediateChangeContext fields do not match the closed contract')
  }
  const result: BillingSubscriptionImmediateContext = {
    cycleIndex: readSubscriptionInteger(value.cycleIndex, 'cycleIndex', 0, 2_147_483_647),
    cycleStart: readSubscriptionInstant(value.cycleStart, 'cycleStart'),
    cycleEnd: readSubscriptionInstant(value.cycleEnd, 'cycleEnd'),
  }
  if ('grantOperationId' in value) {
    result.grantOperationId = readSubscriptionGuid(value.grantOperationId, 'grantOperationId')
  }
  return result
}

function parseSubscriptionItem(value: unknown, expectedClientId: string): BillingSubscriptionItem {
  if (!isRecord(value) ||
      !hasRequiredAndAllowedKeys(value, SUBSCRIPTION_REQUIRED_KEYS, SUBSCRIPTION_OPTIONAL_KEYS)) {
    throw subscriptionContractError('subscription fields do not match the closed contract')
  }
  const clientId = readSubscriptionGuid(value.clientId, 'clientId')
  if (clientId !== expectedClientId) throw subscriptionContractError('subscription Client does not match the request')
  const status = typeof value.status === 'string' && SUBSCRIPTION_STATUSES.has(value.status)
    ? value.status as BillingSubscriptionItem['status']
    : (() => { throw subscriptionContractError('subscription status is unsupported') })()
  const item: BillingSubscriptionItem = {
    subscriptionId: readSubscriptionGuid(value.subscriptionId, 'subscriptionId'),
    creationOperationId: readSubscriptionUuidV7(value.creationOperationId, 'creationOperationId'),
    planTermsOperationId: readSubscriptionGuid(value.planTermsOperationId, 'planTermsOperationId'),
    clientId,
    planName: readSubscriptionPlanName(value.planName),
    subscriptionTier: readSubscriptionTier(value.subscriptionTier),
    tierRevision: readTierRevision(value.tierRevision),
    cycleCreditAmount: readSubscriptionDecimal(value.cycleCreditAmount, 'cycleCreditAmount', true),
    entitlements: parseEntitlements(value.entitlements),
    changeEffectivePolicy: readChangePolicy(value.changeEffectivePolicy),
    prorationPolicy: readProrationPolicy(value.prorationPolicy),
    unusedCreditPolicy: value.unusedCreditPolicy === 'rollover'
      ? 'rollover' : (() => { throw subscriptionContractError('unusedCreditPolicy is unsupported') })(),
    billingCycleAnchor: readSubscriptionInstant(value.billingCycleAnchor, 'billingCycleAnchor'),
    status,
    validFrom: readSubscriptionInstant(value.validFrom, 'validFrom'),
    validTo: value.validTo === null ? null : readSubscriptionInstant(value.validTo, 'validTo'),
    createdAt: readSubscriptionInstant(value.createdAt, 'createdAt'),
    updatedAt: readSubscriptionInstant(value.updatedAt, 'updatedAt'),
  }
  if ('pendingImmediateDebit' in value) item.pendingImmediateDebit = parseImmediateDebit(value.pendingImmediateDebit)
  if ('immediateChangeContext' in value) item.immediateChangeContext = parseImmediateContext(value.immediateChangeContext)
  return item
}

function parseGrant(value: unknown): BillingSubscriptionGrant {
  if (!isRecord(value) || !hasExactKeys(value, GRANT_KEYS)) {
    throw subscriptionContractError('grant fields do not match the closed contract')
  }
  const grantType = typeof value.grantType === 'string' && GRANT_TYPES.has(value.grantType)
    ? value.grantType as BillingSubscriptionGrant['grantType']
    : (() => { throw subscriptionContractError('grantType is unsupported') })()
  return {
    grantId: readSubscriptionGuid(value.grantId, 'grantId'),
    grantOperationId: readSubscriptionGuid(value.grantOperationId, 'grantOperationId'),
    subscriptionId: readSubscriptionGuid(value.subscriptionId, 'subscriptionId'),
    planTermsOperationId: readSubscriptionGuid(value.planTermsOperationId, 'planTermsOperationId'),
    planNameSnapshot: readSubscriptionPlanName(value.planNameSnapshot, 'planNameSnapshot'),
    subscriptionTierSnapshot: readSubscriptionTier(
      value.subscriptionTierSnapshot, 'subscriptionTierSnapshot'
    ),
    tierRevisionSnapshot: readTierRevision(value.tierRevisionSnapshot, 'tierRevisionSnapshot'),
    entitlementsSnapshot: parseEntitlements(value.entitlementsSnapshot),
    grantType,
    cycleStart: readSubscriptionInstant(value.cycleStart, 'cycleStart'),
    cycleEnd: readSubscriptionInstant(value.cycleEnd, 'cycleEnd'),
    creditAmount: readSubscriptionDecimal(value.creditAmount, 'creditAmount', true),
    ledgerEntryId: readSubscriptionGuid(value.ledgerEntryId, 'ledgerEntryId'),
    createdAt: readSubscriptionInstant(value.createdAt, 'createdAt'),
  }
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
        throw subscriptionContractError('response contains a duplicate object property')
      }
      objectKeys.add(key)
    }
  }
}

function parseSubscriptionPayload(text: string): Record<string, unknown> {
  let payload: unknown
  assertNoDuplicateJsonObjectKeys(text)
  try {
    payload = parse(text)
  } catch {
    throw subscriptionContractError('response is not valid JSON')
  }
  if (!isRecord(payload)) throw subscriptionContractError('payload must be an object')
  return payload
}

export function parseBillingSubscriptionState(
  text: string,
  expectedClientId: string
): BillingSubscriptionState {
  const expectedClient = canonicalizeGuid(expectedClientId)
  if (!expectedClient) throw subscriptionContractError('requested Client ID is invalid')
  const payload = parseSubscriptionPayload(text)
  if (!hasRequiredAndAllowedKeys(payload, STATE_REQUIRED_KEYS, STATE_OPTIONAL_KEYS)) {
    throw subscriptionContractError('state fields do not match the closed contract')
  }
  const clientId = readSubscriptionGuid(payload.clientId, 'clientId')
  if (clientId !== expectedClient) throw subscriptionContractError('state Client does not match the request')
  if (!Array.isArray(payload.subscriptionHistory)) {
    throw subscriptionContractError('subscriptionHistory must be an array')
  }
  if (!isRecord(payload.grantHistory) || !hasExactKeys(payload.grantHistory, GRANT_HISTORY_KEYS) ||
      !Array.isArray(payload.grantHistory.items)) {
    throw subscriptionContractError('grantHistory fields do not match the closed contract')
  }
  const stateAsOf = readSubscriptionInstant(payload.stateAsOf, 'stateAsOf')
  const historyAsOf = readSubscriptionInstant(payload.grantHistory.historyAsOf, 'historyAsOf')
  const grants = payload.grantHistory.items.map(parseGrant)
  for (const field of ['grantId', 'grantOperationId', 'ledgerEntryId'] as const) {
    if (new Set(grants.map((item) => item[field])).size !== grants.length) {
      throw subscriptionContractError('grantHistory contains a duplicate grant identity')
    }
  }
  for (let index = 1; index < grants.length; index += 1) {
    const previous = grants[index - 1]!
    const next = grants[index]!
    const timeOrder = compareInstants(previous.cycleStart, next.cycleStart)
    if (timeOrder < 0 || (timeOrder === 0 && previous.grantId.localeCompare(next.grantId) < 0)) {
      throw subscriptionContractError('grantHistory is not in server order')
    }
  }
  const nextCursor = payload.grantHistory.nextCursor === null
    ? null
    : typeof payload.grantHistory.nextCursor === 'string' && payload.grantHistory.nextCursor.length > 0
      ? payload.grantHistory.nextCursor
      : (() => { throw subscriptionContractError('nextCursor is invalid') })()
  const current = payload.current === null ? null : parseSubscriptionItem(payload.current, expectedClient)
  const subscriptionHistory = payload.subscriptionHistory.map((item) => parseSubscriptionItem(item, expectedClient))
  const subscriptions = [current, ...subscriptionHistory].filter(
    (item): item is BillingSubscriptionItem => item !== null
  )
  if ((current && current.status !== 'active' && current.status !== 'paused') ||
      subscriptionHistory.some((item) => item.status !== 'cancelled' && item.status !== 'expired')) {
    throw subscriptionContractError('current and history statuses are inconsistent')
  }
  for (const field of ['subscriptionId', 'creationOperationId'] as const) {
    if (new Set(subscriptions.map((item) => item[field])).size !== subscriptions.length) {
      throw subscriptionContractError('subscription state contains a duplicate identity')
    }
  }
  const subscriptionsById = new Map(subscriptions.map((item) => [item.subscriptionId, item]))
  for (const subscription of subscriptions) {
    if ((subscription.validTo && compareInstants(subscription.validTo, subscription.validFrom) <= 0) ||
        compareInstants(subscription.billingCycleAnchor, subscription.validFrom) !== 0 ||
        compareInstants(subscription.createdAt, stateAsOf) > 0 ||
        compareInstants(subscription.updatedAt, subscription.createdAt) < 0 ||
        compareInstants(subscription.updatedAt, stateAsOf) > 0) {
      throw subscriptionContractError('subscription validity or timestamp evidence is inconsistent')
    }
  }
  if (compareInstants(historyAsOf, stateAsOf) > 0) {
    throw subscriptionContractError('grant watermark occurs after state watermark')
  }
  for (const grant of grants) {
    const subscription = subscriptionsById.get(grant.subscriptionId)
    if (!subscription || compareInstants(grant.cycleEnd, grant.cycleStart) <= 0 ||
        compareInstants(grant.createdAt, historyAsOf) > 0) {
      throw subscriptionContractError('grant relationship or timestamp evidence is inconsistent')
    }
    if (grant.planTermsOperationId === subscription.planTermsOperationId &&
        (grant.planNameSnapshot !== subscription.planName ||
         !entitlementsEqual(grant.entitlementsSnapshot, subscription.entitlements) ||
         !decimalsEqual(grant.creditAmount, subscription.cycleCreditAmount))) {
      throw subscriptionContractError('grant snapshot does not match its plan terms')
    }
  }
  const result: BillingSubscriptionState = {
    clientId,
    stateAsOf,
    current,
    pendingChange: parsePendingChange(payload.pendingChange),
    subscriptionHistory,
    grantHistory: { items: grants, historyAsOf, nextCursor },
  }
  if ('pendingImmediateDebit' in payload) result.pendingImmediateDebit = parseImmediateDebit(payload.pendingImmediateDebit)
  if ('immediateChangeContext' in payload) result.immediateChangeContext = parseImmediateContext(payload.immediateChangeContext)
  if ('pendingTierChange' in payload) {
    if (!current) throw subscriptionContractError('pendingTierChange requires a current subscription')
    const pendingTierChange = parsePendingTierChange(payload.pendingTierChange)
    if (pendingTierChange.expectedTierRevision !== current.tierRevision) {
      throw subscriptionContractError('pendingTierChange revision does not match current subscription')
    }
    result.pendingTierChange = pendingTierChange
  }
  return result
}

export async function getBillingSubscriptionState(
  clientId: string,
  request: BillingSubscriptionPageRequest = { pageSize: 20 },
  signal?: AbortSignal
): Promise<BillingSubscriptionState> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw subscriptionContractError('requested Client ID is invalid')
  const params = new URLSearchParams()
  if (typeof request.cursor === 'string') {
    if (!request.cursor.trim()) throw subscriptionContractError('cursor is invalid')
    params.set('cursor', request.cursor)
  } else if (request.pageSize !== undefined) {
    if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) {
      throw subscriptionContractError('pageSize is invalid')
    }
    params.set('pageSize', String(request.pageSize))
  }
  const response = await apiClient.getApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/subscriptions?${params.toString()}`,
    { responseType: 'text', signal }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw subscriptionContractError('state response is invalid')
  }
  return parseBillingSubscriptionState(response.data, canonicalClientId)
}

function decimalsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return normalize(left) === normalize(right)
}

function entitlementsEqual(left: BillingEntitlementsV1, right: BillingEntitlementsV1): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.rateLimits.requestsPerMinute === right.rateLimits.requestsPerMinute &&
    left.rateLimits.concurrentAiOperations === right.rateLimits.concurrentAiOperations &&
    left.featureFlags.contentGeneration === right.featureFlags.contentGeneration &&
    left.featureFlags.imageGeneration === right.featureFlags.imageGeneration
}

function nullableInstantsEqual(left: string | null, right: string | null): boolean {
  return left === null || right === null
    ? left === right
    : Date.parse(left) === Date.parse(right)
}

function instantKey(value: string): string {
  const match = SUBSCRIPTION_INSTANT_PATTERN.exec(value)
  if (!match) throw subscriptionContractError('instant is invalid')
  return `${match.slice(1, 7).join('')}${(match[7] ?? '').padEnd(6, '0')}`
}

function compareInstants(left: string, right: string): number {
  return instantKey(left).localeCompare(instantKey(right))
}

function firstCalendarBoundary(value: string): string {
  const match = SUBSCRIPTION_INSTANT_PATTERN.exec(value)!
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const absoluteMonth = year * 12 + month
  const targetYear = Math.floor(absoluteMonth / 12)
  const targetMonth = absoluteMonth % 12
  const monthProbe = new Date(0)
  monthProbe.setUTCFullYear(targetYear, targetMonth + 1, 0)
  const targetDay = Math.min(day, monthProbe.getUTCDate())
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}T${match[4]}:${match[5]}:${match[6]}.${(match[7] ?? '').padEnd(6, '0')}Z`
}

function decimalUnits(value: string): bigint {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const units = BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'))
  return negative ? -units : units
}

export function serializeCreateBillingSubscriptionRequest(
  request: CreateBillingSubscriptionRequest
): string {
  if (!isRecord(request) || !hasExactKeys(request, CREATION_REQUEST_KEYS) ||
      !isRecord(request.entitlements) || !hasExactKeys(request.entitlements, ENTITLEMENT_KEYS) ||
      !isRecord(request.entitlements.rateLimits) ||
      !hasExactKeys(request.entitlements.rateLimits, RATE_LIMIT_KEYS) ||
      !isRecord(request.entitlements.featureFlags) ||
      !hasExactKeys(request.entitlements.featureFlags, FEATURE_FLAG_KEYS)) {
    throw subscriptionContractError('creation request fields do not match the closed contract')
  }
  if (!UUID_V7_PATTERN.test(request.creationOperationId)) {
    throw subscriptionContractError('creationOperationId must be UUIDv7')
  }
  readSubscriptionPlanName(request.planName)
  readSubscriptionTier(request.subscriptionTier)
  if (!POSITIVE_DECIMAL_PATTERN.test(request.cycleCreditAmount) ||
      /^0(?:\.0+)?$/.test(request.cycleCreditAmount)) {
    throw subscriptionContractError('cycleCreditAmount is outside the DECIMAL(18,4) contract')
  }
  if (request.changeEffectivePolicy !== 'immediate' || request.prorationPolicy !== 'replace' ||
      request.unusedCreditPolicy !== 'rollover') {
    throw subscriptionContractError('creation policies are invalid')
  }
  if (request.entitlements.schemaVersion !== 1 ||
      typeof request.entitlements.featureFlags.contentGeneration !== 'boolean' ||
      typeof request.entitlements.featureFlags.imageGeneration !== 'boolean' ||
      !Number.isInteger(request.entitlements.rateLimits.requestsPerMinute) ||
      request.entitlements.rateLimits.requestsPerMinute < 1 ||
      request.entitlements.rateLimits.requestsPerMinute > 10_000 ||
      !Number.isInteger(request.entitlements.rateLimits.concurrentAiOperations) ||
      request.entitlements.rateLimits.concurrentAiOperations < 1 ||
      request.entitlements.rateLimits.concurrentAiOperations > 1_000 ||
      (!request.entitlements.featureFlags.contentGeneration &&
       !request.entitlements.featureFlags.imageGeneration)) {
    throw subscriptionContractError('entitlements are invalid')
  }
  if (!request.validFrom.endsWith('Z') ||
      (request.validTo !== null && !request.validTo.endsWith('Z'))) {
    throw subscriptionContractError('validity must use canonical UTC instants')
  }
  readSubscriptionInstant(request.validFrom, 'validFrom')
  if (request.validTo !== null) readSubscriptionInstant(request.validTo, 'validTo')
  const body = stringify({
    creationOperationId: request.creationOperationId,
    planName: request.planName,
    subscriptionTier: request.subscriptionTier,
    cycleCreditAmount: new LosslessNumber(request.cycleCreditAmount),
    validFrom: request.validFrom,
    validTo: request.validTo,
    changeEffectivePolicy: 'immediate',
    prorationPolicy: 'replace',
    unusedCreditPolicy: 'rollover',
    entitlements: {
      schemaVersion: 1,
      rateLimits: {
        requestsPerMinute: request.entitlements.rateLimits.requestsPerMinute,
        concurrentAiOperations: request.entitlements.rateLimits.concurrentAiOperations,
      },
      featureFlags: {
        contentGeneration: request.entitlements.featureFlags.contentGeneration,
        imageGeneration: request.entitlements.featureFlags.imageGeneration,
      },
    },
  })
  if (typeof body !== 'string' || new TextEncoder().encode(body).length > 16 * 1024) {
    throw subscriptionContractError('request body is invalid')
  }
  return body
}

export function parseBillingSubscriptionCreationReceipt(
  text: string,
  expectedClientId: string,
  request: CreateBillingSubscriptionRequest
): BillingSubscriptionCreationReceipt {
  const payload = parseSubscriptionPayload(text)
  const expectedClient = canonicalizeGuid(expectedClientId)
  if (!expectedClient || !hasExactKeys(payload, CREATION_RECEIPT_KEYS) ||
      typeof payload.created !== 'boolean' || !isRecord(payload.subscription) ||
      !hasExactKeys(payload.subscription, CREATION_SUBSCRIPTION_KEYS) ||
      !isRecord(payload.initialGrant) || !hasExactKeys(payload.initialGrant, CREATION_GRANT_KEYS) ||
      !isRecord(payload.account) || !hasExactKeys(payload.account, CREATION_ACCOUNT_KEYS)) {
    throw subscriptionContractError('creation receipt fields do not match the closed contract')
  }
  const subscriptionValue = payload.subscription
  const grantValue = payload.initialGrant
  const accountValue = payload.account
  const subscriptionClient = readSubscriptionGuid(subscriptionValue.clientId, 'subscription clientId')
  const accountClient = readSubscriptionGuid(accountValue.clientId, 'account clientId')
  const creationOperationId = readSubscriptionUuidV7(
    subscriptionValue.creationOperationId, 'creationOperationId'
  )
  const planTermsOperationId = readSubscriptionGuid(
    subscriptionValue.planTermsOperationId, 'planTermsOperationId'
  )
  const subscriptionId = readSubscriptionGuid(subscriptionValue.subscriptionId, 'subscriptionId')
  const entitlements = parseEntitlements(subscriptionValue.entitlements)
  const subscriptionAmount = readSubscriptionDecimal(
    subscriptionValue.cycleCreditAmount, 'cycleCreditAmount', true
  )
  const subscriptionTier = readSubscriptionTier(subscriptionValue.subscriptionTier)
  const tierRevision = readTierRevision(subscriptionValue.tierRevision)
  const grantTier = readSubscriptionTier(
    grantValue.subscriptionTierSnapshot, 'subscriptionTierSnapshot'
  )
  const grantTierRevision = readTierRevision(
    grantValue.tierRevisionSnapshot, 'tierRevisionSnapshot'
  )
  const validFrom = readSubscriptionInstant(subscriptionValue.validFrom, 'validFrom')
  const validTo = subscriptionValue.validTo === null
    ? null : readSubscriptionInstant(subscriptionValue.validTo, 'validTo')
  const grantEntitlements = parseEntitlements(grantValue.entitlementsSnapshot)
  const grantAmount = readSubscriptionDecimal(grantValue.creditAmount, 'creditAmount', true)
  const grantPlanTermsOperationId = readSubscriptionGuid(
    grantValue.planTermsOperationId, 'grant planTermsOperationId'
  )
  const billingCycleAnchor = readSubscriptionInstant(subscriptionValue.billingCycleAnchor, 'billingCycleAnchor')
  const cycleStart = readSubscriptionInstant(grantValue.cycleStart, 'cycleStart')
  const cycleEnd = readSubscriptionInstant(grantValue.cycleEnd, 'cycleEnd')
  const ownedBalance = readSubscriptionDecimal(accountValue.ownedBalance, 'ownedBalance')
  const reservedBalance = readSubscriptionDecimal(accountValue.activelyReservedAmount, 'activelyReservedAmount')
  const availableBalance = readSubscriptionDecimal(accountValue.availableBalance, 'availableBalance')
  if (subscriptionClient !== expectedClient || accountClient !== expectedClient ||
      creationOperationId !== request.creationOperationId ||
      planTermsOperationId !== request.creationOperationId ||
      grantPlanTermsOperationId !== planTermsOperationId ||
      subscriptionValue.planName !== request.planName ||
      grantValue.planNameSnapshot !== request.planName ||
      subscriptionTier !== request.subscriptionTier ||
      grantTier !== request.subscriptionTier ||
      grantTier !== subscriptionTier ||
      tierRevision !== '0' || grantTierRevision !== tierRevision ||
      !decimalsEqual(subscriptionAmount, request.cycleCreditAmount) ||
      !decimalsEqual(grantAmount, request.cycleCreditAmount) ||
      !entitlementsEqual(entitlements, request.entitlements) ||
      !entitlementsEqual(grantEntitlements, request.entitlements) ||
      subscriptionValue.changeEffectivePolicy !== 'immediate' ||
      subscriptionValue.prorationPolicy !== 'replace' ||
      subscriptionValue.unusedCreditPolicy !== 'rollover' ||
      subscriptionValue.status !== 'active' || grantValue.grantType !== 'billing_cycle' ||
      Date.parse(validFrom) !== Date.parse(request.validFrom) ||
      !nullableInstantsEqual(validTo, request.validTo) ||
      compareInstants(billingCycleAnchor, validFrom) !== 0 ||
      compareInstants(cycleStart, validFrom) !== 0 ||
      compareInstants(cycleEnd, firstCalendarBoundary(validFrom)) !== 0 ||
      decimalUnits(ownedBalance) < 0n || decimalUnits(reservedBalance) < 0n ||
      decimalUnits(availableBalance) < 0n ||
      decimalUnits(ownedBalance) - decimalUnits(reservedBalance) !== decimalUnits(availableBalance)) {
    throw subscriptionContractError('creation receipt does not match the confirmed operation')
  }
  const accountStatus = typeof accountValue.status === 'string' &&
    ACCOUNT_STATUSES.has(accountValue.status as BillingAccountStatus)
    ? accountValue.status as BillingAccountStatus
    : (() => { throw subscriptionContractError('account status is unsupported') })()
  return {
    created: payload.created,
    subscription: {
      subscriptionId, creationOperationId, planTermsOperationId, clientId: subscriptionClient,
      planName: request.planName, subscriptionTier, tierRevision,
      cycleCreditAmount: subscriptionAmount, entitlements,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
      billingCycleAnchor,
      status: 'active', validFrom, validTo,
    },
    initialGrant: {
      grantId: readSubscriptionGuid(grantValue.grantId, 'grantId'),
      grantOperationId: readSubscriptionGuid(grantValue.grantOperationId, 'grantOperationId'),
      ledgerEntryId: readSubscriptionGuid(grantValue.ledgerEntryId, 'ledgerEntryId'),
      planTermsOperationId: grantPlanTermsOperationId,
      planNameSnapshot: request.planName,
      subscriptionTierSnapshot: grantTier,
      tierRevisionSnapshot: grantTierRevision,
      entitlementsSnapshot: grantEntitlements,
      grantType: 'billing_cycle',
      cycleStart,
      cycleEnd,
      creditAmount: grantAmount,
    },
    account: {
      creditAccountId: readSubscriptionGuid(accountValue.creditAccountId, 'creditAccountId'),
      clientId: accountClient,
      ownedBalance,
      activelyReservedAmount: reservedBalance,
      availableBalance,
      status: accountStatus,
      asOf: readSubscriptionInstant(accountValue.asOf, 'account asOf'),
    },
  }
}

export async function createBillingSubscription(
  clientId: string,
  request: CreateBillingSubscriptionRequest,
  signal?: AbortSignal,
  retainedBody?: string
): Promise<BillingSubscriptionCreationReceipt> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw subscriptionContractError('requested Client ID is invalid')
  const canonicalBody = serializeCreateBillingSubscriptionRequest(request)
  if (retainedBody !== undefined && retainedBody !== canonicalBody) {
    throw subscriptionContractError('retained request body does not match the confirmed operation')
  }
  const body = retainedBody ?? canonicalBody
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/subscriptions`,
    body,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' } }
  )
  if ((response.status !== 200 && response.status !== 201) || typeof response.data !== 'string') {
    throw subscriptionContractError('creation response is invalid')
  }
  const receipt = parseBillingSubscriptionCreationReceipt(response.data, canonicalClientId, request)
  if ((response.status === 201) !== receipt.created) {
    throw subscriptionContractError('creation status does not match the receipt')
  }
  return receipt
}

function validateLifecycleReason(reason: unknown): asserts reason is string {
  if (typeof reason !== 'string' || /^\p{White_Space}|\p{White_Space}$/u.test(reason)) {
    throw subscriptionContractError('lifecycle reason is invalid')
  }
  let count = 0
  for (const scalar of reason) {
    const value = scalar.codePointAt(0)!
    if ((value >= 0xd800 && value <= 0xdfff) || /\p{Cc}/u.test(scalar)) {
      throw subscriptionContractError('lifecycle reason is invalid')
    }
    count += 1
  }
  if (count < 1 || count > 512) {
    throw subscriptionContractError('lifecycle reason must contain 1 to 512 Unicode scalars')
  }
}

function lifecycleTarget(
  action: BillingSubscriptionLifecycleAction,
  expectedStatus: string
): BillingSubscriptionItem['status'] {
  if (expectedStatus !== 'active' && expectedStatus !== 'paused') {
    throw subscriptionContractError('lifecycle expectedStatus is unsupported')
  }
  if (action === 'pause' && expectedStatus === 'active') return 'paused'
  if (action === 'reactivate' && expectedStatus === 'paused') return 'active'
  if (action === 'cancel') return 'cancelled'
  if (action === 'expire') return 'expired'
  throw subscriptionContractError('lifecycle action is invalid for expectedStatus')
}

export function serializeBillingSubscriptionLifecycleRequest(
  request: BillingSubscriptionLifecycleRequest
): string {
  if (!isRecord(request) || !hasExactKeys(request, LIFECYCLE_REQUEST_KEYS)) {
    throw subscriptionContractError('lifecycle request fields do not match the closed contract')
  }
  const lifecycleOperationId = readSubscriptionUuidV7(
    request.lifecycleOperationId, 'lifecycleOperationId'
  )
  if (typeof request.action !== 'string' ||
      !LIFECYCLE_ACTIONS.has(request.action as BillingSubscriptionLifecycleAction)) {
    throw subscriptionContractError('lifecycle action is unsupported')
  }
  lifecycleTarget(request.action as BillingSubscriptionLifecycleAction, request.expectedStatus)
  validateLifecycleReason(request.reason)
  const body = JSON.stringify({
    lifecycleOperationId,
    action: request.action,
    expectedStatus: request.expectedStatus,
    reason: request.reason,
  })
  if (new TextEncoder().encode(body).length > 16 * 1024) {
    throw subscriptionContractError('lifecycle request body is too large')
  }
  return body
}

export function parseBillingSubscriptionLifecycleReceipt(
  text: string,
  expectedClientId: string,
  expectedSubscriptionId: string,
  request: BillingSubscriptionLifecycleRequest,
  validTo: string | null = null
): BillingSubscriptionLifecycleReceipt {
  const payload = parseSubscriptionPayload(text)
  if (!hasExactKeys(payload, LIFECYCLE_RECEIPT_KEYS)) {
    throw subscriptionContractError('lifecycle receipt fields do not match the closed contract')
  }
  const clientId = readSubscriptionGuid(payload.clientId, 'clientId')
  const subscriptionId = readSubscriptionGuid(payload.subscriptionId, 'subscriptionId')
  const lifecycleOperationId = readSubscriptionUuidV7(
    payload.lifecycleOperationId, 'lifecycleOperationId'
  )
  const action = typeof payload.action === 'string' &&
    LIFECYCLE_ACTIONS.has(payload.action as BillingSubscriptionLifecycleAction)
    ? payload.action as BillingSubscriptionLifecycleAction
    : (() => { throw subscriptionContractError('lifecycle receipt action is unsupported') })()
  const previousStatus = payload.previousStatus === 'active' || payload.previousStatus === 'paused'
    ? payload.previousStatus
    : (() => { throw subscriptionContractError('lifecycle receipt previousStatus is unsupported') })()
  const status = typeof payload.status === 'string' && SUBSCRIPTION_STATUSES.has(payload.status)
    ? payload.status as BillingSubscriptionItem['status']
    : (() => { throw subscriptionContractError('lifecycle receipt status is unsupported') })()
  validateLifecycleReason(payload.reason)
  const effectiveAt = readSubscriptionInstant(payload.effectiveAt, 'effectiveAt')
  const operationAsOf = readSubscriptionInstant(payload.operationAsOf, 'operationAsOf')
  const expectedClient = canonicalizeGuid(expectedClientId)
  const expectedSubscription = canonicalizeGuid(expectedSubscriptionId)
  const expectedOperation = readSubscriptionUuidV7(
    request.lifecycleOperationId, 'lifecycleOperationId'
  )
  if (!expectedClient || !expectedSubscription || clientId !== expectedClient ||
      subscriptionId !== expectedSubscription ||
      lifecycleOperationId !== expectedOperation || action !== request.action ||
      previousStatus !== request.expectedStatus || payload.reason !== request.reason) {
    throw subscriptionContractError('lifecycle receipt does not match the confirmed operation')
  }
  const target = lifecycleTarget(request.action, request.expectedStatus)
  if (status !== target) {
    throw subscriptionContractError('lifecycle receipt transition is invalid')
  }
  if (action === 'expire') {
    if (!validTo || compareInstants(effectiveAt, readSubscriptionInstant(validTo, 'validTo')) !== 0) {
      throw subscriptionContractError('lifecycle receipt does not match validTo')
    }
    if (compareInstants(effectiveAt, operationAsOf) > 0) {
      throw subscriptionContractError('lifecycle receipt timestamp relationship is invalid')
    }
  } else if (compareInstants(effectiveAt, operationAsOf) !== 0) {
    throw subscriptionContractError('lifecycle receipt timestamp relationship is invalid')
  }
  return {
    lifecycleOperationId, clientId, subscriptionId, action, previousStatus, status,
    reason: payload.reason, effectiveAt, operationAsOf,
  }
}

export async function postBillingSubscriptionLifecycle(
  clientId: string,
  subscriptionId: string,
  request: BillingSubscriptionLifecycleRequest,
  signal?: AbortSignal,
  retainedBody?: string,
  validTo: string | null = null,
  onAuthReplay?: () => void
): Promise<BillingSubscriptionLifecycleReceipt> {
  const canonicalClientId = canonicalizeGuid(clientId)
  const canonicalSubscriptionId = canonicalizeGuid(subscriptionId)
  if (!canonicalClientId || !canonicalSubscriptionId) {
    throw subscriptionContractError('lifecycle route identifiers are invalid')
  }
  const canonicalBody = serializeBillingSubscriptionLifecycleRequest(request)
  if (retainedBody !== undefined && retainedBody !== canonicalBody) {
    throw subscriptionContractError('retained lifecycle body does not match the confirmed operation')
  }
  const body = retainedBody ?? canonicalBody
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/subscriptions/${canonicalSubscriptionId}/lifecycle`,
    body,
    {
      responseType: 'text', signal, headers: { 'Content-Type': 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}),
    }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw subscriptionContractError('lifecycle response is invalid')
  }
  return parseBillingSubscriptionLifecycleReceipt(
    response.data, canonicalClientId, canonicalSubscriptionId, request, validTo
  )
}

const PREVIEW_REQUEST_KEYS = [
  'action', 'effectivePolicy', 'expectedStatus', 'expectedTierRevision', 'subscriptionTier',
] as const
const PREVIEW_KEYS = [
  'accessUntil', 'action', 'affectedResources', 'affectedResourcesTruncated',
  'classificationRevision', 'clientId', 'commandAuthorityHash',
  'commandEffectiveAt', 'currentSubscriptionTier', 'deadlineGroups',
  'deadlineGroupsTruncated',
  'earliestProofExpiry', 'effectivePolicy', 'evaluatedAt', 'graceCount', 'lossAt', 'pendingTierChangeOperationId',
  'policyActivationRevision', 'policyHash', 'policyPublicationId', 'policyVersion',
  'preservationFacts', 'retainedCount', 'statusRevision', 'subscriptionId',
  'suspendedCount', 'targetSubscriptionTier', 'tierRevision', 'totalCount',
  'unlistedGraceCount', 'unlistedNewlyAffectedCount',
] as const
const PREVIEW_RESOURCE_KEYS = ['accessUntil', 'disposition', 'proofExpiresAt', 'resourceId', 'resourceType'] as const
const PREVIEW_PRESERVATION_KEYS = [
  'acceptedAiWorkUnchanged', 'assetsPreserved', 'contentPreserved', 'creditsUnchanged',
] as const
const CONSEQUENCE_PRESERVATION_KEYS = [
  'assetsPreserved', 'contentPreserved', 'financialEffectsPreserved',
  'ownershipPreserved', 'tlsEvidencePreserved',
] as const
const PREVIEW_ACTIONS = new Set<ResourceAccessPreviewAction>([
  'apply_immediate', 'schedule', 'replace', 'cancel_pending',
  'pause', 'reactivate', 'cancel', 'expire',
])
const TIER_RESPONSE_KEYS = ['receipt', 'schemaVersion', 'tierState'] as const
const TIER_RECEIPT_REQUIRED_KEYS = [
  'effectiveAt', 'effectivePolicy', 'expectedTierRevision', 'operationAsOf', 'operationId',
  'outcome', 'previousSubscriptionTier', 'previousTierRevision', 'reason',
  'requestedSubscriptionTier', 'resultingSubscriptionTier', 'resultingTierRevision',
  'schemaVersion', 'subscriptionId', 'clientId',
] as const
const TIER_RECEIPT_OPTIONAL_KEYS = [
  'action', 'pendingSubscriptionTier', 'pendingTierChangeOperationId',
  'previousPendingSubscriptionTier', 'previousPendingTierChangeOperationId',
] as const
const TIER_STATE_KEYS = [
  'observedAt', 'pendingTierChange', 'status', 'subscriptionTier', 'tierRevision',
  'validFrom', 'validTo',
] as const

function nullableSubscriptionInstant(value: unknown, field: string): string | null {
  return value === null ? null : readSubscriptionInstant(value, field)
}

function nullableUuidV7(value: unknown, field: string): string | null {
  return value === null ? null : readSubscriptionUuidV7(value, field)
}

function parsePreviewResource(value: unknown): ResourceAccessPreviewResource {
  if (!isRecord(value) || !hasExactKeys(value, PREVIEW_RESOURCE_KEYS) ||
      (value.resourceType !== 'product' && value.resourceType !== 'domain_binding') ||
      (value.disposition !== 'grace' && value.disposition !== 'suspended')) {
    throw subscriptionContractError('preview resource fields are invalid')
  }
  const accessUntil = nullableSubscriptionInstant(value.accessUntil, 'preview resource accessUntil')
  const proofExpiresAt = nullableSubscriptionInstant(value.proofExpiresAt, 'preview resource proofExpiresAt')
  if (proofExpiresAt && (value.resourceType !== 'domain_binding' ||
      value.disposition !== 'grace' || !accessUntil ||
      compareInstants(proofExpiresAt, accessUntil) >= 0))
    throw subscriptionContractError('preview proof expiry is inconsistent')
  return {
    resourceType: value.resourceType,
    resourceId: readSubscriptionGuid(value.resourceId, 'preview resourceId'),
    disposition: value.disposition,
    accessUntil, proofExpiresAt,
  }
}

export function serializeResourceAccessPreviewRequest(
  request: ResourceAccessPreviewRequest
): string {
  if (!isRecord(request) || !hasExactKeys(request, PREVIEW_REQUEST_KEYS) ||
      !PREVIEW_ACTIONS.has(request.action) ||
      (request.expectedStatus !== 'active' && request.expectedStatus !== 'paused')) {
    throw subscriptionContractError('preview request fields are invalid')
  }
  const expectedTierRevision = validateTierRevisionString(
    request.expectedTierRevision, 'expectedTierRevision'
  )
  const subscriptionTier = request.subscriptionTier === null
    ? null : readSubscriptionTier(request.subscriptionTier)
  const effectivePolicy = request.effectivePolicy
  const tierAction = request.action === 'apply_immediate' || request.action === 'schedule' ||
    request.action === 'replace' || request.action === 'cancel_pending'
  if ((tierAction && (subscriptionTier === null || effectivePolicy === null)) ||
      (!tierAction && (subscriptionTier !== null || effectivePolicy !== null)) ||
      (request.action === 'apply_immediate' && effectivePolicy !== 'immediate') ||
      (request.action !== 'apply_immediate' && tierAction && effectivePolicy !== 'next_billing_cycle') ||
      (!tierAction && effectivePolicy !== null)) {
    throw subscriptionContractError('preview action material is inconsistent')
  }
  return stringify({
    action: request.action,
    expectedStatus: request.expectedStatus,
    expectedTierRevision: new LosslessNumber(expectedTierRevision),
    subscriptionTier,
    effectivePolicy,
  }) as string
}

export function parseResourceAccessPreview(
  text: string,
  expectedClientId: string,
  expectedSubscriptionId: string,
  request: ResourceAccessPreviewRequest
): ResourceAccessPreview {
  const payload = parseSubscriptionPayload(text)
  if (!hasExactKeys(payload, PREVIEW_KEYS) || !Array.isArray(payload.affectedResources) ||
      !Array.isArray(payload.deadlineGroups) ||
      !isRecord(payload.preservationFacts) ||
      !hasExactKeys(payload.preservationFacts, PREVIEW_PRESERVATION_KEYS)) {
    throw subscriptionContractError('preview response fields do not match the closed contract')
  }
  const clientId = readSubscriptionGuid(payload.clientId, 'preview clientId')
  const subscriptionId = readSubscriptionGuid(payload.subscriptionId, 'preview subscriptionId')
  if (clientId !== canonicalizeGuid(expectedClientId) ||
      subscriptionId !== canonicalizeGuid(expectedSubscriptionId) ||
      payload.action !== request.action ||
      readTierRevision(payload.tierRevision) !== request.expectedTierRevision ||
      payload.effectivePolicy !== request.effectivePolicy ||
      payload.targetSubscriptionTier !== request.subscriptionTier) {
    throw subscriptionContractError('preview response does not match the requested authority')
  }
  const facts = payload.preservationFacts
  if (facts.contentPreserved !== true || facts.assetsPreserved !== true ||
      facts.creditsUnchanged !== true || facts.acceptedAiWorkUnchanged !== true) {
    throw subscriptionContractError('preview preservation facts are invalid')
  }
  const resources = payload.affectedResources.map(parsePreviewResource)
  const totalCount = readSubscriptionInteger(payload.totalCount, 'totalCount', 0, 2_147_483_647)
  const retainedCount = readSubscriptionInteger(payload.retainedCount, 'retainedCount', 0, 2_147_483_647)
  const graceCount = readSubscriptionInteger(payload.graceCount, 'graceCount', 0, 2_147_483_647)
  const suspendedCount = readSubscriptionInteger(payload.suspendedCount, 'suspendedCount', 0, 2_147_483_647)
  const unlistedGraceCount = readSubscriptionInteger(payload.unlistedGraceCount,
    'unlistedGraceCount', 0, graceCount)
  const unlistedNewlyAffectedCount = readSubscriptionInteger(payload.unlistedNewlyAffectedCount,
    'unlistedNewlyAffectedCount', 0, unlistedGraceCount)
  if (retainedCount + graceCount + suspendedCount !== totalCount || resources.length > 200 ||
      typeof payload.affectedResourcesTruncated !== 'boolean' ||
      typeof payload.deadlineGroupsTruncated !== 'boolean') {
    throw subscriptionContractError('preview consequence counts are inconsistent')
  }
  const policyVersion = typeof payload.policyVersion === 'string' && payload.policyVersion.length > 0
    ? payload.policyVersion : (() => { throw subscriptionContractError('policyVersion is invalid') })()
  const policyHash = typeof payload.policyHash === 'string' && payload.policyHash.length > 0 &&
    payload.policyHash.length <= 256 ? payload.policyHash
    : (() => { throw subscriptionContractError('policyHash is invalid') })()
  const action = payload.action as ResourceAccessPreviewAction
  const commandEffectiveAt = nullableSubscriptionInstant(payload.commandEffectiveAt,
    'commandEffectiveAt')
  const commandAuthorityHash = payload.commandAuthorityHash
  const tierAction = action === 'apply_immediate' || action === 'schedule' ||
    action === 'replace' || action === 'cancel_pending'
  if ((tierAction && (typeof commandAuthorityHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(commandAuthorityHash))) ||
      (!tierAction && commandAuthorityHash !== null) ||
      (action === 'schedule' || action === 'replace' || action === 'cancel_pending') !==
        (commandEffectiveAt !== null))
    throw subscriptionContractError('preview command authority is invalid')
  const lossAt = nullableSubscriptionInstant(payload.lossAt, 'lossAt')
  const accessUntil = nullableSubscriptionInstant(payload.accessUntil, 'accessUntil')
  const earliestProofExpiry = nullableSubscriptionInstant(payload.earliestProofExpiry,
    'earliestProofExpiry')
  const deadlineGroups = payload.deadlineGroups.map((group) => {
    if (!isRecord(group) || !hasExactKeys(group, [
      'accessUntil', 'graceCount', 'lossAt', 'newlyAffectedCount',
    ])) throw subscriptionContractError('preview deadline group is invalid')
    const groupLossAt = readSubscriptionInstant(group.lossAt, 'deadline group lossAt')
    const groupAccessUntil = readSubscriptionInstant(group.accessUntil, 'deadline group accessUntil')
    const groupGraceCount = readSubscriptionInteger(group.graceCount, 'deadline group graceCount', 1, 2_147_483_647)
    const newlyAffectedCount = readSubscriptionInteger(group.newlyAffectedCount, 'newlyAffectedCount', 0, groupGraceCount)
    if (compareInstants(groupLossAt, groupAccessUntil) >= 0)
      throw subscriptionContractError('preview deadline group timing is invalid')
    return { lossAt: groupLossAt, accessUntil: groupAccessUntil,
      graceCount: groupGraceCount, newlyAffectedCount }
  })
  if ((graceCount > 0) !== Boolean(lossAt && accessUntil) ||
      (lossAt && accessUntil && compareInstants(lossAt, accessUntil) >= 0) ||
      deadlineGroups.length > 200 ||
      deadlineGroups.reduce((sum, group) => sum + group.graceCount, 0) +
        unlistedGraceCount !== graceCount ||
      payload.deadlineGroupsTruncated !== (unlistedGraceCount > 0) ||
      (deadlineGroups.length > 0 && (deadlineGroups[0]!.lossAt !== lossAt ||
        deadlineGroups[0]!.accessUntil !== accessUntil)) ||
      deadlineGroups.some((group, index) => index > 0 &&
        compareInstants(deadlineGroups[index - 1]!.accessUntil, group.accessUntil) > 0) ||
      (earliestProofExpiry !== null && (graceCount === 0 ||
        !deadlineGroups.some(group => compareInstants(earliestProofExpiry, group.lossAt) > 0 &&
          compareInstants(earliestProofExpiry, group.accessUntil) < 0))) ||
      (!payload.affectedResourcesTruncated &&
        (resources.map(resource => resource.proofExpiresAt).filter((value): value is string => value !== null)
          .sort(compareInstants)[0] ?? null) !== earliestProofExpiry)) {
    throw subscriptionContractError('preview consequence timing is inconsistent')
  }
  return {
    clientId, subscriptionId, action,
    currentSubscriptionTier: readSubscriptionTier(payload.currentSubscriptionTier),
    targetSubscriptionTier: payload.targetSubscriptionTier === null
      ? null : readSubscriptionTier(payload.targetSubscriptionTier),
    effectivePolicy: payload.effectivePolicy === null ? null : readChangePolicy(payload.effectivePolicy),
    statusRevision: readTierRevision(payload.statusRevision, 'statusRevision'),
    classificationRevision: readTierRevision(payload.classificationRevision, 'classificationRevision'),
    tierRevision: readTierRevision(payload.tierRevision),
    pendingTierChangeOperationId: nullableUuidV7(
      payload.pendingTierChangeOperationId, 'pendingTierChangeOperationId'
    ),
    policyPublicationId: readSubscriptionGuid(payload.policyPublicationId, 'policyPublicationId'),
    policyActivationRevision: readTierRevision(payload.policyActivationRevision, 'policyActivationRevision'),
    policyVersion, policyHash,
    evaluatedAt: readSubscriptionInstant(payload.evaluatedAt, 'evaluatedAt'),
    commandEffectiveAt, commandAuthorityHash: commandAuthorityHash as string | null,
    lossAt, accessUntil, earliestProofExpiry, retainedCount, totalCount, graceCount, suspendedCount,
    deadlineGroups, deadlineGroupsTruncated: payload.deadlineGroupsTruncated,
    unlistedGraceCount, unlistedNewlyAffectedCount,
    affectedResourcesTruncated: payload.affectedResourcesTruncated,
    preservationFacts: {
      contentPreserved: true, assetsPreserved: true,
      creditsUnchanged: true, acceptedAiWorkUnchanged: true,
    },
    affectedResources: resources,
  }
}

export async function getResourceAccessPreview(
  clientId: string,
  subscriptionId: string,
  request: ResourceAccessPreviewRequest,
  signal?: AbortSignal
): Promise<ResourceAccessPreview> {
  const canonicalClientId = canonicalizeGuid(clientId)
  const canonicalSubscriptionId = canonicalizeGuid(subscriptionId)
  if (!canonicalClientId || !canonicalSubscriptionId) {
    throw subscriptionContractError('preview route identifiers are invalid')
  }
  const body = serializeResourceAccessPreviewRequest(request)
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/subscriptions/${canonicalSubscriptionId}/resource-access-preview`,
    body,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' } }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw subscriptionContractError('preview response is invalid')
  }
  return parseResourceAccessPreview(
    response.data, canonicalClientId, canonicalSubscriptionId, request
  )
}

export function serializeBillingSubscriptionTierChangeRequest(
  action: BillingSubscriptionTierAction,
  request: BillingSubscriptionTierChangeRequest
): string {
  const pending = action === 'replace' || action === 'cancel_pending'
  const allowed = pending
    ? ['commandAuthorityHash', 'expectedPendingTierChangeOperationId', 'expectedTierRevision', 'operationId', 'reason', 'subscriptionTier']
    : ['commandAuthorityHash', 'effectivePolicy', 'expectedTierRevision', 'operationId', 'reason', 'subscriptionTier']
  if (!isRecord(request) || !hasExactKeys(request, allowed) ||
      !UUID_V7_PATTERN.test(request.operationId) ||
      typeof request.commandAuthorityHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.commandAuthorityHash)) {
    throw subscriptionContractError('tier-change request fields are invalid')
  }
  const expectedTierRevision = validateTierRevisionString(
    request.expectedTierRevision, 'expectedTierRevision'
  )
  const subscriptionTier = readSubscriptionTier(request.subscriptionTier)
  const reason = readTierChangeReason(request.reason)
  if (pending) {
    const expectedPending = readSubscriptionUuidV7(
      request.expectedPendingTierChangeOperationId, 'expectedPendingTierChangeOperationId'
    )
    return stringify({
      operationId: request.operationId,
      expectedTierRevision: new LosslessNumber(expectedTierRevision),
      expectedPendingTierChangeOperationId: expectedPending,
      subscriptionTier,
      reason,
      commandAuthorityHash: request.commandAuthorityHash,
    }) as string
  }
  const expectedPolicy = action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle'
  if (request.effectivePolicy !== expectedPolicy) {
    throw subscriptionContractError('tier-change effectivePolicy is invalid')
  }
  return stringify({
    operationId: request.operationId,
    expectedTierRevision: new LosslessNumber(expectedTierRevision),
    subscriptionTier,
    effectivePolicy: expectedPolicy,
    reason,
    commandAuthorityHash: request.commandAuthorityHash,
  }) as string
}

export function parseBillingSubscriptionTierChangeResponse(
  text: string,
  expectedClientId: string,
  expectedSubscriptionId: string,
  action: BillingSubscriptionTierAction,
  request: BillingSubscriptionTierChangeRequest
): BillingSubscriptionTierChangeResponse {
  const payload = parseSubscriptionPayload(text)
  const carriesPendingAction = action !== 'apply_immediate'
  const receiptKeys = (carriesPendingAction
    ? [...TIER_RECEIPT_REQUIRED_KEYS, ...TIER_RECEIPT_OPTIONAL_KEYS]
    : [...TIER_RECEIPT_REQUIRED_KEYS]).sort()
  if (!hasExactKeys(payload, TIER_RESPONSE_KEYS) || payload.schemaVersion?.toString() !== '1' ||
      !isRecord(payload.receipt) ||
      !hasExactKeys(payload.receipt, receiptKeys) ||
      !isRecord(payload.tierState) || !hasExactKeys(payload.tierState, TIER_STATE_KEYS)) {
    throw subscriptionContractError('tier-change response fields are invalid')
  }
  const receipt = payload.receipt
  const tierState = payload.tierState
  const clientId = readSubscriptionGuid(receipt.clientId, 'receipt clientId')
  const subscriptionId = readSubscriptionGuid(receipt.subscriptionId, 'receipt subscriptionId')
  const operationId = readSubscriptionUuidV7(receipt.operationId, 'operationId')
  const receiptAction = action === 'schedule' ? 'schedule'
    : action === 'replace' ? 'replace' : action === 'cancel_pending' ? 'cancel' : undefined
  if (clientId !== canonicalizeGuid(expectedClientId) ||
      subscriptionId !== canonicalizeGuid(expectedSubscriptionId) ||
      operationId !== request.operationId ||
      readTierRevision(receipt.expectedTierRevision, 'expectedTierRevision') !== request.expectedTierRevision ||
      receipt.requestedSubscriptionTier !== request.subscriptionTier ||
      receipt.reason !== request.reason || receipt.effectivePolicy !== (request.effectivePolicy ?? 'next_billing_cycle') ||
      (receiptAction === undefined ? 'action' in receipt : receipt.action !== receiptAction)) {
    throw subscriptionContractError('tier-change receipt does not match the retained command')
  }
  const outcome = receipt.outcome
  if (outcome !== 'changed' && outcome !== 'no_change' && outcome !== 'scheduled' &&
      outcome !== 'replaced' && outcome !== 'cancelled') {
    throw subscriptionContractError('tier-change outcome is unsupported')
  }
  const status = tierState.status
  if (typeof status !== 'string' || !SUBSCRIPTION_STATUSES.has(status)) {
    throw subscriptionContractError('tier state status is unsupported')
  }
  const result: BillingSubscriptionTierChangeResponse = {
    schemaVersion: 1,
    receipt: {
      schemaVersion: readSubscriptionInteger(receipt.schemaVersion, 'receipt schemaVersion', 1, 1) as 1,
      operationId, clientId, subscriptionId, outcome,
      effectivePolicy: readChangePolicy(receipt.effectivePolicy),
      requestedSubscriptionTier: readSubscriptionTier(receipt.requestedSubscriptionTier),
      previousSubscriptionTier: readSubscriptionTier(receipt.previousSubscriptionTier),
      resultingSubscriptionTier: readSubscriptionTier(receipt.resultingSubscriptionTier),
      expectedTierRevision: readTierRevision(receipt.expectedTierRevision, 'expectedTierRevision'),
      previousTierRevision: readTierRevision(receipt.previousTierRevision, 'previousTierRevision'),
      resultingTierRevision: readTierRevision(receipt.resultingTierRevision, 'resultingTierRevision'),
      reason: readTierChangeReason(receipt.reason),
      operationAsOf: readSubscriptionInstant(receipt.operationAsOf, 'operationAsOf'),
      effectiveAt: readSubscriptionInstant(receipt.effectiveAt, 'effectiveAt'),
    },
    tierState: {
      subscriptionTier: readSubscriptionTier(tierState.subscriptionTier),
      tierRevision: readTierRevision(tierState.tierRevision),
      status: status as BillingSubscriptionTierState['status'],
      validFrom: readSubscriptionInstant(tierState.validFrom, 'tier state validFrom'),
      validTo: nullableSubscriptionInstant(tierState.validTo, 'tier state validTo'),
      pendingTierChange: tierState.pendingTierChange === null
        ? null : parsePendingTierChange(tierState.pendingTierChange),
      observedAt: readSubscriptionInstant(tierState.observedAt, 'observedAt'),
    },
  }
  if (receiptAction) result.receipt.action = receiptAction
  for (const [field, parser] of [
    ['previousPendingTierChangeOperationId', readSubscriptionUuidV7],
    ['pendingTierChangeOperationId', readSubscriptionUuidV7],
  ] as const) {
    if (field in receipt) {
      result.receipt[field] = receipt[field] === null ? null : parser(receipt[field], field)
    }
  }
  if ('previousPendingSubscriptionTier' in receipt) {
    result.receipt.previousPendingSubscriptionTier = receipt.previousPendingSubscriptionTier === null
      ? null : readSubscriptionTier(receipt.previousPendingSubscriptionTier, 'previousPendingSubscriptionTier')
  }
  if ('pendingSubscriptionTier' in receipt) {
    result.receipt.pendingSubscriptionTier = receipt.pendingSubscriptionTier === null
      ? null : readSubscriptionTier(receipt.pendingSubscriptionTier, 'pendingSubscriptionTier')
  }
  validateTierChangeResult(action, request, result)
  return result
}

function validateTierChangeResult(
  action: BillingSubscriptionTierAction,
  request: BillingSubscriptionTierChangeRequest,
  result: BillingSubscriptionTierChangeResponse
): void {
  const receipt = result.receipt
  const state = result.tierState
  const sameInstant = (left: string, right: string) => Date.parse(left) === Date.parse(right)
  const base = receipt.expectedTierRevision === receipt.previousTierRevision &&
    state.subscriptionTier === receipt.resultingSubscriptionTier &&
    state.tierRevision === receipt.resultingTierRevision
  let valid = base
  if (receipt.outcome === 'changed') {
    valid &&= action === 'apply_immediate' && receipt.effectivePolicy === 'immediate' &&
      sameInstant(receipt.effectiveAt, receipt.operationAsOf) &&
      receipt.requestedSubscriptionTier !== receipt.previousSubscriptionTier &&
      receipt.resultingSubscriptionTier === receipt.requestedSubscriptionTier &&
      BigInt(receipt.previousTierRevision) < INT64_MAX &&
      BigInt(receipt.resultingTierRevision) === BigInt(receipt.previousTierRevision) + 1n &&
      state.pendingTierChange === null
  } else if (receipt.outcome === 'no_change') {
    valid &&= (action === 'apply_immediate' || action === 'schedule') &&
      sameInstant(receipt.effectiveAt, receipt.operationAsOf) &&
      receipt.requestedSubscriptionTier === receipt.previousSubscriptionTier &&
      receipt.resultingSubscriptionTier === receipt.previousSubscriptionTier &&
      receipt.resultingTierRevision === receipt.previousTierRevision &&
      state.pendingTierChange === null &&
      (action === 'apply_immediate' ? receipt.effectivePolicy === 'immediate' :
        receipt.effectivePolicy === 'next_billing_cycle')
  } else if (receipt.outcome === 'scheduled' || receipt.outcome === 'replaced') {
    const expectedAction = receipt.outcome === 'scheduled' ? 'schedule' : 'replace'
    valid &&= action === expectedAction && receipt.action === expectedAction &&
      receipt.effectivePolicy === 'next_billing_cycle' &&
      Date.parse(receipt.effectiveAt) > Date.parse(receipt.operationAsOf) &&
      receipt.resultingTierRevision === receipt.previousTierRevision &&
      receipt.resultingSubscriptionTier === receipt.previousSubscriptionTier &&
      receipt.requestedSubscriptionTier !== receipt.previousSubscriptionTier &&
      receipt.pendingTierChangeOperationId === receipt.operationId &&
      receipt.pendingSubscriptionTier === receipt.requestedSubscriptionTier &&
      (receipt.outcome === 'scheduled'
        ? receipt.previousPendingTierChangeOperationId === null &&
          receipt.previousPendingSubscriptionTier === null
        : receipt.previousPendingTierChangeOperationId === request.expectedPendingTierChangeOperationId &&
          receipt.previousPendingSubscriptionTier !== null &&
          receipt.previousPendingSubscriptionTier !== receipt.requestedSubscriptionTier) &&
      state.pendingTierChange?.operationId === receipt.operationId &&
      state.pendingTierChange.subscriptionTier === receipt.requestedSubscriptionTier &&
      state.pendingTierChange.expectedTierRevision === receipt.resultingTierRevision &&
      sameInstant(state.pendingTierChange.effectiveCycleStart, receipt.effectiveAt) &&
      state.pendingTierChange.reason === receipt.reason
  } else if (receipt.outcome === 'cancelled') {
    valid &&= action === 'cancel_pending' && receipt.action === 'cancel' &&
      receipt.effectivePolicy === 'next_billing_cycle' &&
      Date.parse(receipt.effectiveAt) >= Date.parse(receipt.operationAsOf) &&
      receipt.resultingTierRevision === receipt.previousTierRevision &&
      receipt.resultingSubscriptionTier === receipt.previousSubscriptionTier &&
      receipt.previousPendingTierChangeOperationId === request.expectedPendingTierChangeOperationId &&
      receipt.previousPendingSubscriptionTier === receipt.requestedSubscriptionTier &&
      receipt.pendingTierChangeOperationId === null && receipt.pendingSubscriptionTier === null &&
      state.pendingTierChange === null
  }
  if (!valid) throw subscriptionContractError('tier-change result evidence is inconsistent')
}

export async function postBillingSubscriptionTierChange(
  clientId: string,
  subscriptionId: string,
  action: BillingSubscriptionTierAction,
  request: BillingSubscriptionTierChangeRequest,
  signal?: AbortSignal,
  retainedBody?: string,
  onAuthReplay?: () => void
): Promise<BillingSubscriptionTierChangeResponse> {
  const canonicalClientId = canonicalizeGuid(clientId)
  const canonicalSubscriptionId = canonicalizeGuid(subscriptionId)
  if (!canonicalClientId || !canonicalSubscriptionId) {
    throw subscriptionContractError('tier-change route identifiers are invalid')
  }
  const canonicalBody = serializeBillingSubscriptionTierChangeRequest(action, request)
  if (retainedBody !== undefined && retainedBody !== canonicalBody) {
    throw subscriptionContractError('retained tier-change body does not match the confirmed command')
  }
  const suffix = action === 'replace' ? '/pending/replace'
    : action === 'cancel_pending' ? '/pending/cancel' : ''
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/subscriptions/${canonicalSubscriptionId}/tier-changes${suffix}`,
    retainedBody ?? canonicalBody,
    {
      responseType: 'text', signal, headers: { 'Content-Type': 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}),
    }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw subscriptionContractError('tier-change response is invalid')
  }
  return parseBillingSubscriptionTierChangeResponse(
    response.data, canonicalClientId, canonicalSubscriptionId, action, request
  )
}

export function parseResourceAccessConsequences(text: string): ResourceAccessConsequence[] {
  let raw: unknown
  try {
    assertNoDuplicateJsonObjectKeys(text)
    raw = parse(text)
  } catch {
    throw subscriptionContractError('consequence response is invalid')
  }
  if (!Array.isArray(raw) || raw.length > 50) {
    throw subscriptionContractError('consequence response is not a bounded array')
  }
  const keys = [
    'accessUntil', 'affectedResources', 'affectedResourcesTruncated', 'causeIdentity',
    'consequenceId', 'consequenceKind', 'deadlineGroups', 'deadlineGroupsTruncated',
    'earliestProofExpiry', 'graceCount', 'lossAt', 'preservationFacts',
    'projectionRevision', 'projectionRunId', 'recordedAt', 'reminders',
    'restoredAt', 'restoredCount', 'retainedCount',
    'suspendedCount', 'suspensionGroups', 'totalCount', 'unlistedGraceCount',
    'unlistedSuspendedCount',
  ] as const
  return raw.map((item): ResourceAccessConsequence => {
    if (!isRecord(item) || !hasExactKeys(item, keys) || !Array.isArray(item.affectedResources) ||
        !Array.isArray(item.reminders) || item.reminders.length > 2 ||
        !Array.isArray(item.deadlineGroups) || item.deadlineGroups.length > 200 ||
        !Array.isArray(item.suspensionGroups) || item.suspensionGroups.length > 200 ||
        !isRecord(item.preservationFacts)) {
      throw subscriptionContractError('consequence item fields are invalid')
    }
    const kind = item.consequenceKind
    if (kind !== 'scheduled' && kind !== 'grace_started' && kind !== 'suspended' &&
        kind !== 'restored' && kind !== 'cancelled') {
      throw subscriptionContractError('consequence kind is invalid')
    }
    const affectedResources = item.affectedResources.map((resource): ResourceAccessConsequenceResource => {
      if (!isRecord(resource) || !hasExactKeys(resource,
        ['accessUntil', 'proofExpiresAt', 'resourceId', 'resourceType', 'state']) ||
          (resource.resourceType !== 'product' && resource.resourceType !== 'domain_binding') ||
          (resource.state !== 'eligible' && resource.state !== 'grace' &&
            resource.state !== 'suspended')) {
        throw subscriptionContractError('consequence resource is invalid')
      }
      const accessUntil = nullableSubscriptionInstant(resource.accessUntil, 'consequence accessUntil')
      const proofExpiresAt = nullableSubscriptionInstant(resource.proofExpiresAt,
        'consequence proofExpiresAt')
      if (proofExpiresAt && (resource.resourceType !== 'domain_binding' ||
          resource.state !== 'grace' || !accessUntil ||
          compareInstants(proofExpiresAt, accessUntil) >= 0))
        throw subscriptionContractError('consequence proof expiry is inconsistent')
      return {
        resourceType: resource.resourceType,
        resourceId: readSubscriptionGuid(resource.resourceId, 'consequence resourceId'),
        state: resource.state,
        accessUntil, proofExpiresAt,
      }
    })
    const rawPreservationFacts = item.preservationFacts
    if (!isRecord(rawPreservationFacts) ||
        !hasExactKeys(rawPreservationFacts, CONSEQUENCE_PRESERVATION_KEYS) ||
        CONSEQUENCE_PRESERVATION_KEYS.some((key) => rawPreservationFacts[key] !== true)) {
      throw subscriptionContractError('consequence preservation facts are invalid')
    }
    const retainedCount = readSubscriptionInteger(item.retainedCount, 'retainedCount', 0, 2_147_483_647)
    const totalCount = readSubscriptionInteger(item.totalCount, 'totalCount', 0, 2_147_483_647)
    const graceCount = readSubscriptionInteger(item.graceCount, 'graceCount', 0, 2_147_483_647)
    const suspendedCount = readSubscriptionInteger(item.suspendedCount, 'suspendedCount', 0, 2_147_483_647)
    const unlistedGraceCount = readSubscriptionInteger(item.unlistedGraceCount,
      'unlistedGraceCount', 0, graceCount)
    const unlistedSuspendedCount = readSubscriptionInteger(item.unlistedSuspendedCount,
      'unlistedSuspendedCount', 0, suspendedCount)
    const deadlineGroups = item.deadlineGroups.map((group) => {
      if (!isRecord(group) || !hasExactKeys(group, ['accessUntil', 'graceCount']))
        throw subscriptionContractError('consequence deadline group is invalid')
      return { accessUntil: nullableSubscriptionInstant(group.accessUntil,
        'consequence deadline group accessUntil'),
      graceCount: readSubscriptionInteger(group.graceCount,
        'consequence deadline group graceCount', 1, 2_147_483_647) }
    })
    const suspensionGroups = item.suspensionGroups.map((group):
      ResourceAccessConsequence['suspensionGroups'][number] => {
      if (!isRecord(group) || !hasExactKeys(group, ['accessUntil', 'reason', 'suspendedCount']))
        throw subscriptionContractError('consequence suspension group is invalid')
      const reason = group.reason
      if (reason !== 'finite_limit' && reason !== 'product_inactive' &&
          reason !== 'product_unpublished' && reason !== 'routing_inactive' &&
          reason !== 'ownership_unverified' && reason !== 'tls_unavailable' &&
          reason !== 'target_product_not_retained' && reason !== 'client_disabled' &&
          reason !== 'policy_unavailable' && reason !== 'hard_denial')
        throw subscriptionContractError('consequence suspension reason is invalid')
      return { accessUntil: nullableSubscriptionInstant(group.accessUntil,
        'consequence suspension group accessUntil'),
      suspendedCount: readSubscriptionInteger(group.suspendedCount,
        'consequence suspension group suspendedCount', 1, 2_147_483_647), reason }
    })
    const restoredCount = item.restoredCount === null ? null :
      readSubscriptionInteger(item.restoredCount, 'restoredCount', 1, totalCount)
    const restoredAt = nullableSubscriptionInstant(item.restoredAt, 'restoredAt')
    if (retainedCount + graceCount + suspendedCount !== totalCount ||
        affectedResources.length > 200 || typeof item.affectedResourcesTruncated !== 'boolean' ||
        typeof item.deadlineGroupsTruncated !== 'boolean' ||
        item.deadlineGroupsTruncated !== (unlistedGraceCount > 0) ||
        deadlineGroups.reduce((sum, group) => sum + group.graceCount, 0) +
          unlistedGraceCount !== graceCount ||
        suspensionGroups.reduce((sum, group) => sum + group.suspendedCount, 0) +
          unlistedSuspendedCount > suspendedCount ||
        (restoredCount === null) !== (restoredAt === null) ||
        (kind !== 'restored' && restoredCount !== null)) {
      throw subscriptionContractError('consequence counts are inconsistent')
    }
    const accessUntil = nullableSubscriptionInstant(item.accessUntil, 'consequence accessUntil')
    const earliestProofExpiry = nullableSubscriptionInstant(item.earliestProofExpiry,
      'consequence earliestProofExpiry')
    if (earliestProofExpiry && (graceCount === 0 ||
        (!item.affectedResourcesTruncated &&
          (affectedResources.map(resource => resource.proofExpiresAt)
            .filter((value): value is string => value !== null)
            .sort(compareInstants)[0] ?? null) !== earliestProofExpiry)))
      throw subscriptionContractError('consequence proof expiry is inconsistent')
    const reminders = item.reminders.map((reminder) => {
      if (!isRecord(reminder) || !hasExactKeys(reminder,
        ['dueAt', 'earliestProofExpiry', 'graceCount', 'recordedAt', 'reminderKind']) ||
          (reminder.reminderKind !== 'reminder_72h' && reminder.reminderKind !== 'reminder_24h'))
        throw subscriptionContractError('consequence reminder is invalid')
      const dueAt = readSubscriptionInstant(reminder.dueAt, 'reminder dueAt')
      const reminderCount = readSubscriptionInteger(reminder.graceCount,
        'reminder graceCount', 0, 2_147_483_647)
      const reminderProofExpiry = nullableSubscriptionInstant(reminder.earliestProofExpiry,
        'reminder earliestProofExpiry')
      if (!accessUntil || compareInstants(dueAt, accessUntil) >= 0 ||
          (reminderProofExpiry && (reminderCount === 0 ||
            compareInstants(reminderProofExpiry, accessUntil) >= 0)))
        throw subscriptionContractError('consequence reminder deadline is invalid')
      return { reminderKind: reminder.reminderKind as 'reminder_72h' | 'reminder_24h', dueAt,
        recordedAt: readSubscriptionInstant(reminder.recordedAt, 'reminder recordedAt'),
        graceCount: reminderCount, earliestProofExpiry: reminderProofExpiry }
    })
    return {
      consequenceId: readSubscriptionGuid(item.consequenceId, 'consequenceId'),
      projectionRunId: readSubscriptionGuid(item.projectionRunId, 'projectionRunId'),
      projectionRevision: readTierRevision(item.projectionRevision, 'projectionRevision'),
      causeIdentity: typeof item.causeIdentity === 'string' && item.causeIdentity.length > 0
        ? item.causeIdentity : (() => { throw subscriptionContractError('causeIdentity is invalid') })(),
      consequenceKind: kind,
      lossAt: nullableSubscriptionInstant(item.lossAt, 'consequence lossAt'),
      accessUntil, earliestProofExpiry,
      retainedCount, totalCount, graceCount, suspendedCount,
      affectedResources, affectedResourcesTruncated: item.affectedResourcesTruncated,
      deadlineGroups, deadlineGroupsTruncated: item.deadlineGroupsTruncated,
      unlistedGraceCount, suspensionGroups, unlistedSuspendedCount,
      restoredCount, restoredAt,
      reminders,
      preservationFacts: {
        contentPreserved: true,
        assetsPreserved: true,
        ownershipPreserved: true,
        tlsEvidencePreserved: true,
        financialEffectsPreserved: true,
      },
      recordedAt: readSubscriptionInstant(item.recordedAt, 'recordedAt'),
    }
  })
}

export async function getResourceAccessConsequences(
  clientId: string,
  signal?: AbortSignal
): Promise<ResourceAccessConsequence[]> {
  const canonicalClientId = canonicalizeGuid(clientId)
  if (!canonicalClientId) throw subscriptionContractError('requested Client ID is invalid')
  const response = await apiClient.getApiRoot<string>(
    `/api/billing/clients/${canonicalClientId}/resource-access-consequences`,
    { responseType: 'text', signal }
  )
  if (response.status !== 200 || typeof response.data !== 'string') {
    throw subscriptionContractError('consequence response is invalid')
  }
  return parseResourceAccessConsequences(response.data)
}

export const billingApi = {
  getAccountSnapshot: getBillingAccountSnapshot,
  getLedgerPage: getBillingLedgerPage,
  getSubscriptionState: getBillingSubscriptionState,
  createSubscription: createBillingSubscription,
  postSubscriptionLifecycle: postBillingSubscriptionLifecycle,
  getResourceAccessPreview,
  getResourceAccessConsequences,
  postSubscriptionTierChange: postBillingSubscriptionTierChange,
  requestLedgerExport: requestBillingLedgerExport,
  getLedgerExportStatus: getBillingLedgerExportStatus,
  redeemLedgerExport: redeemBillingLedgerExport,
  getClientCapabilities,
}
