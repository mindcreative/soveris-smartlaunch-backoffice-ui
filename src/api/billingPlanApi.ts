import { isLosslessNumber, LosslessNumber, parse, stringify } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { useAuthStore } from '../stores/authStore'
import type {
  BillingEntitlementsV1,
  BillingSubscriptionImmediatePlanChangeReceipt,
  BillingSubscriptionPendingChange,
  BillingSubscriptionPlanChangeAction,
  BillingSubscriptionPlanChangeCommandRequest,
  BillingSubscriptionPlanChangePreview,
  BillingSubscriptionPlanChangePreviewRequest,
  BillingSubscriptionPlanChangeReceipt,
  BillingSubscriptionPlanTerms,
  BillingSubscriptionProrationPolicy,
  BillingSubscriptionScheduledPlanChangeReceipt,
  BillingSubscriptionTier,
} from '../types/billing'

const DECIMAL = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const REQUEST_DECIMAL = /^(?:0\.\d{1,4}|[1-9]\d{0,13}(?:\.\d{1,4})?)$/
const UINT64 = /^(?:0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/
const TOKEN = /^v1\.[0-9a-f]{64}$/
const INT64_MAX = 9_223_372_036_854_775_807n

export class BillingPlanContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing plan-change contract: ${reason}`)
    this.name = 'BillingPlanContractError'
  }
}

type JsonRecord = Record<string, unknown>
const fail = (reason: string): never => { throw new BillingPlanContractError(reason) }
const record = (value: unknown, field: string): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : fail(`${field} must be an object`)
const exact = (value: JsonRecord, keys: readonly string[], field: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i]))
    fail(`${field} fields are invalid`)
}
const text = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : fail(`${field} must be text`)
const guid = (value: unknown, field: string): string => {
  const candidate = text(value, field).toLowerCase()
  return UUID.test(candidate) ? candidate : fail(`${field} must be a GUID`)
}
const uuid7 = (value: unknown, field: string): string => {
  const candidate = guid(value, field)
  return UUID_V7.test(candidate) ? candidate : fail(`${field} must be UUIDv7`)
}
const local = (value: unknown, field: string): string => {
  const candidate = text(value, field)
  return LOCAL.test(candidate) ? candidate : fail(`${field} must be a plain local timestamp`)
}
const decimal = (value: unknown, field: string): string => {
  if (!isLosslessNumber(value)) fail(`${field} must be an exact JSON number`)
  const candidate = (value as LosslessNumber).toString()
  return DECIMAL.test(candidate) ? candidate : fail(`${field} is outside DECIMAL(18,4)`)
}
const integer = (value: unknown, field: string): number => {
  if (!isLosslessNumber(value) || !/^\d+$/.test(value.toString())) fail(`${field} must be an integer`)
  const number = Number((value as LosslessNumber).toString())
  return Number.isSafeInteger(number) && number <= 2_147_483_647
    ? number : fail(`${field} is outside Int32`)
}
const int64 = (value: unknown, field: string): string => {
  if (!isLosslessNumber(value) || !UINT64.test(value.toString()) || BigInt(value.toString()) > INT64_MAX)
    fail(`${field} is outside Int64`)
  return (value as LosslessNumber).toString()
}
const nullable = <T>(value: unknown, parser: (input: unknown, field: string) => T, field: string): T | null =>
  value === null ? null : parser(value, field)

function entitlements(value: unknown, field: string): BillingEntitlementsV1 {
  const root = record(value, field)
  exact(root, ['schemaVersion', 'rateLimits', 'featureFlags'], field)
  if (!isLosslessNumber(root.schemaVersion) || root.schemaVersion.toString() !== '1') fail(`${field}.schemaVersion`)
  const rates = record(root.rateLimits, `${field}.rateLimits`)
  exact(rates, ['requestsPerMinute', 'concurrentAiOperations'], `${field}.rateLimits`)
  const flags = record(root.featureFlags, `${field}.featureFlags`)
  exact(flags, ['contentGeneration', 'imageGeneration'], `${field}.featureFlags`)
  const rpm = integer(rates.requestsPerMinute, `${field}.requestsPerMinute`)
  const concurrent = integer(rates.concurrentAiOperations, `${field}.concurrentAiOperations`)
  if (rpm < 1 || rpm > 10_000 || concurrent < 1 || concurrent > 1_000 ||
      typeof flags.contentGeneration !== 'boolean' || typeof flags.imageGeneration !== 'boolean' ||
      (!flags.contentGeneration && !flags.imageGeneration)) fail(`${field} values are invalid`)
  return { schemaVersion: 1, rateLimits: { requestsPerMinute: rpm, concurrentAiOperations: concurrent },
    featureFlags: { contentGeneration: flags.contentGeneration as boolean,
      imageGeneration: flags.imageGeneration as boolean } }
}

function proration(value: unknown, field: string): BillingSubscriptionProrationPolicy {
  return value === 'none' || value === 'replace' || value === 'prorate'
    ? value : fail(`${field} is invalid`)
}
function tier(value: unknown): BillingSubscriptionTier {
  return value === 'freemium' || value === 'basic' || value === 'brand' || value === 'brand_premium'
    ? value : fail('subscriptionTier is invalid')
}
function terms(value: unknown, field: string): BillingSubscriptionPlanTerms {
  const item = record(value, field)
  exact(item, ['planName', 'cycleCreditAmount', 'entitlements', 'changeEffectivePolicy',
    'prorationPolicy', 'unusedCreditPolicy'], field)
  const planName = text(item.planName, `${field}.planName`)
  if (planName !== planName.trim() || planName.length < 1 || planName.length > 128)
    fail(`${field}.planName is invalid`)
  if (item.changeEffectivePolicy !== 'immediate' && item.changeEffectivePolicy !== 'next_billing_cycle')
    fail(`${field}.changeEffectivePolicy is invalid`)
  if (item.unusedCreditPolicy !== 'rollover') fail(`${field}.unusedCreditPolicy is invalid`)
  return { planName, cycleCreditAmount: decimal(item.cycleCreditAmount, `${field}.cycleCreditAmount`),
    entitlements: entitlements(item.entitlements, `${field}.entitlements`),
    changeEffectivePolicy: item.changeEffectivePolicy as BillingSubscriptionPlanTerms['changeEffectivePolicy'],
    prorationPolicy: proration(item.prorationPolicy, `${field}.prorationPolicy`),
    unusedCreditPolicy: 'rollover' }
}

function requestTerms(value: JsonRecord, field: string, action: Exclude<BillingSubscriptionPlanChangeAction, 'cancel'>): BillingSubscriptionPlanTerms {
  const planName = text(value.planName, `${field}.planName`)
  const credit = text(value.cycleCreditAmount, `${field}.cycleCreditAmount`)
  if (planName !== planName.trim() || planName.length < 1 || planName.length > 128 ||
      !REQUEST_DECIMAL.test(credit) || value.unusedCreditPolicy !== 'rollover')
    fail(`${field} terms are invalid`)
  const requestEntitlements = record(value.entitlements, `${field}.entitlements`)
  const entitlementJson = stringify(requestEntitlements) as string
  return { planName, cycleCreditAmount: credit,
    entitlements: entitlements(parse(entitlementJson), `${field}.entitlements`),
    changeEffectivePolicy: action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle',
    prorationPolicy: proration(value.prorationPolicy, `${field}.prorationPolicy`),
    unusedCreditPolicy: 'rollover' }
}

const sameEntitlements = (left: BillingEntitlementsV1, right: BillingEntitlementsV1): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.rateLimits.requestsPerMinute === right.rateLimits.requestsPerMinute &&
  left.rateLimits.concurrentAiOperations === right.rateLimits.concurrentAiOperations &&
  left.featureFlags.contentGeneration === right.featureFlags.contentGeneration &&
  left.featureFlags.imageGeneration === right.featureFlags.imageGeneration

function sameTarget(termsValue: BillingSubscriptionPlanTerms,
  request: Exclude<BillingSubscriptionPlanChangePreviewRequest, { action: 'cancel' }>): boolean {
  return termsValue.planName === request.planName &&
    termsValue.cycleCreditAmount === request.cycleCreditAmount &&
    sameEntitlements(termsValue.entitlements, request.entitlements) &&
    termsValue.changeEffectivePolicy === (request.action === 'apply_immediate'
      ? 'immediate' : 'next_billing_cycle') &&
    termsValue.prorationPolicy === request.prorationPolicy &&
    termsValue.unusedCreditPolicy === request.unusedCreditPolicy
}

function pending(value: unknown): BillingSubscriptionPendingChange | { status: 'unsupported' } | null {
  if (value === null) return null
  const item = record(value, 'pendingChangeBefore')
  if (item.status === 'unsupported') { exact(item, ['status'], 'pendingChangeBefore'); return { status: 'unsupported' } }
  exact(item, ['schemaVersion', 'planChangeOperationId', 'planName', 'cycleCreditAmount',
    'entitlements', 'changeEffectivePolicy', 'prorationPolicy', 'unusedCreditPolicy',
    'effectiveCycleIndex', 'effectiveCycleStart', 'effectiveCycleEnd', 'scheduledAt'], 'pendingChangeBefore')
  const parsedTerms = terms({
    planName: item.planName,
    cycleCreditAmount: item.cycleCreditAmount,
    entitlements: item.entitlements,
    changeEffectivePolicy: item.changeEffectivePolicy,
    prorationPolicy: item.prorationPolicy,
    unusedCreditPolicy: item.unusedCreditPolicy,
  }, 'pendingChangeBefore')
  if (parsedTerms.changeEffectivePolicy !== 'next_billing_cycle') fail('pending change policy is invalid')
  return { schemaVersion: integer(item.schemaVersion, 'pending schemaVersion'),
    planChangeOperationId: uuid7(item.planChangeOperationId, 'pending operationId'),
    ...parsedTerms, effectiveCycleIndex: integer(item.effectiveCycleIndex, 'pending cycleIndex'),
    effectiveCycleStart: local(item.effectiveCycleStart, 'pending cycleStart'),
    effectiveCycleEnd: local(item.effectiveCycleEnd, 'pending cycleEnd'),
    scheduledAt: local(item.scheduledAt, 'pending scheduledAt') }
}

function calculation(value: unknown) {
  const item = record(value, 'calculation')
  exact(item, ['policyVersion', 'fundingBasis', 'cycleIndex', 'cycleStart', 'cycleEnd',
    'currentCycleGrantOperationId', 'totalCycleMicroseconds', 'remainingCycleMicroseconds',
    'delta', 'appliedDelta', 'outstandingDelta'], 'calculation')
  return { policyVersion: text(item.policyVersion, 'policyVersion'),
    fundingBasis: text(item.fundingBasis, 'fundingBasis'), cycleIndex: integer(item.cycleIndex, 'cycleIndex'),
    cycleStart: local(item.cycleStart, 'cycleStart'), cycleEnd: local(item.cycleEnd, 'cycleEnd'),
    currentCycleGrantOperationId: nullable(item.currentCycleGrantOperationId, uuid7, 'currentCycleGrantOperationId'),
    totalCycleMicroseconds: int64(item.totalCycleMicroseconds, 'totalCycleMicroseconds'),
    remainingCycleMicroseconds: int64(item.remainingCycleMicroseconds, 'remainingCycleMicroseconds'),
    delta: decimal(item.delta, 'delta'), appliedDelta: decimal(item.appliedDelta, 'appliedDelta'),
    outstandingDelta: decimal(item.outstandingDelta, 'outstandingDelta') }
}

function account(value: unknown) {
  const item = record(value, 'account')
  exact(item, ['creditAccountId', 'walletVersionBefore', 'walletVersionAfter', 'balanceBefore',
    'reservedBalanceBefore', 'availableBalanceBefore', 'balanceAfter', 'reservedBalanceAfter',
    'availableBalanceAfter'], 'account')
  return { creditAccountId: guid(item.creditAccountId, 'creditAccountId'),
    walletVersionBefore: int64(item.walletVersionBefore, 'walletVersionBefore'),
    walletVersionAfter: int64(item.walletVersionAfter, 'walletVersionAfter'),
    balanceBefore: decimal(item.balanceBefore, 'balanceBefore'),
    reservedBalanceBefore: decimal(item.reservedBalanceBefore, 'reservedBalanceBefore'),
    availableBalanceBefore: decimal(item.availableBalanceBefore, 'availableBalanceBefore'),
    balanceAfter: decimal(item.balanceAfter, 'balanceAfter'),
    reservedBalanceAfter: decimal(item.reservedBalanceAfter, 'reservedBalanceAfter'),
    availableBalanceAfter: decimal(item.availableBalanceAfter, 'availableBalanceAfter') }
}

export function serializeBillingPlanPreviewRequest(request: BillingSubscriptionPlanChangePreviewRequest): string {
  if (request.action === 'cancel') {
    exact(record(request, 'preview request'), ['action'], 'preview request')
    return stringify({ action: 'cancel' }) as string
  }
  exact(record(request, 'preview request'), ['action', 'planName', 'cycleCreditAmount',
    'entitlements', 'prorationPolicy', 'unusedCreditPolicy'], 'preview request')
  if (!['schedule', 'replace', 'apply_immediate'].includes(request.action) ||
      !REQUEST_DECIMAL.test(request.cycleCreditAmount) || request.unusedCreditPolicy !== 'rollover')
    fail('preview request is invalid')
  const parsedTerms = requestTerms(record(request, 'preview request'), 'request', request.action)
  return stringify({ action: request.action, planName: parsedTerms.planName,
    cycleCreditAmount: new LosslessNumber(parsedTerms.cycleCreditAmount),
    entitlements: parsedTerms.entitlements, prorationPolicy: parsedTerms.prorationPolicy,
    unusedCreditPolicy: 'rollover' }) as string
}

export function serializeBillingPlanCommandRequest(request: BillingSubscriptionPlanChangeCommandRequest): string {
  const value = record(request, 'command request')
  const commandKeys = request.action === 'cancel'
    ? ['action', 'planChangeOperationId', 'previewToken', 'reason']
    : ['action', 'planName', 'cycleCreditAmount', 'entitlements', 'prorationPolicy',
        'unusedCreditPolicy', 'planChangeOperationId', 'previewToken', 'reason']
  exact(value, commandKeys, 'command request')
  if (!UUID_V7.test(request.planChangeOperationId) || !TOKEN.test(request.previewToken) ||
      request.reason !== request.reason.trim() || [...request.reason].length < 1 ||
      [...request.reason].length > 512 || /[\u0000-\u001f\u007f]/.test(request.reason))
    fail('command authority is invalid')
  if (request.action === 'cancel') {
    return stringify({ action: 'cancel', planChangeOperationId: request.planChangeOperationId,
      previewToken: request.previewToken, reason: request.reason }) as string
  }
  if (!['schedule', 'replace', 'apply_immediate'].includes(request.action) ||
      !REQUEST_DECIMAL.test(request.cycleCreditAmount) || request.unusedCreditPolicy !== 'rollover')
    fail('command request is invalid')
  const parsedTerms = requestTerms(value, 'request', request.action)
  return stringify({ action: request.action, planName: parsedTerms.planName,
    cycleCreditAmount: new LosslessNumber(parsedTerms.cycleCreditAmount),
    entitlements: parsedTerms.entitlements, prorationPolicy: parsedTerms.prorationPolicy,
    unusedCreditPolicy: 'rollover', planChangeOperationId: request.planChangeOperationId,
    previewToken: request.previewToken, reason: request.reason }) as string
}

function payload(textValue: string): JsonRecord {
  try { return record(parse(textValue), 'response') } catch (error) {
    if (error instanceof BillingPlanContractError) throw error
    return fail('response is not valid JSON')
  }
}

export function parseBillingPlanPreview(textValue: string, request: BillingSubscriptionPlanChangePreviewRequest): BillingSubscriptionPlanChangePreview {
  const root = payload(textValue)
  exact(root, ['schemaVersion', 'action', 'previewToken', 'previewedAt', 'currentTerms',
    'targetTerms', 'pendingChangeBefore', 'pendingResult', 'effectiveCycle', 'creditEffect',
    'pendingImmediateDebitAfter'], 'preview')
  if (!isLosslessNumber(root.schemaVersion) || root.schemaVersion.toString() !== '1' ||
      root.action !== request.action || typeof root.previewToken !== 'string' || !TOKEN.test(root.previewToken))
    fail('preview identity is invalid')
  const currentTerms = terms(root.currentTerms, 'currentTerms')
  const targetTerms = root.targetTerms === null ? null : terms(root.targetTerms, 'targetTerms')
  const effect = record(root.creditEffect, 'creditEffect')
  exact(effect, ['timing', 'currentCycleCreditAmount', 'targetCycleCreditAmount', 'calculation', 'account'], 'creditEffect')
  const immediate = request.action === 'apply_immediate'
  if (effect.timing !== (immediate ? 'immediate' : 'next_billing_cycle') ||
      (immediate !== (effect.calculation !== null && effect.account !== null))) fail('credit effect is invalid')
  const cycle = root.effectiveCycle === null ? null : (() => {
    const value = record(root.effectiveCycle, 'effectiveCycle')
    exact(value, ['cycleIndex', 'cycleStart', 'cycleEnd'], 'effectiveCycle')
    return { cycleIndex: integer(value.cycleIndex, 'cycleIndex'),
      cycleStart: local(value.cycleStart, 'cycleStart'), cycleEnd: local(value.cycleEnd, 'cycleEnd') }
  })()
  if (!cycle) fail('effectiveCycle is required')
  const result = root.pendingResult
  if (!['created', 'replaced', 'cancelled', 'preserved', 'none'].includes(String(result)))
    fail('pendingResult is invalid')
  const remainder = root.pendingImmediateDebitAfter === null ? null : (() => {
    const value = record(root.pendingImmediateDebitAfter, 'pendingImmediateDebitAfter')
    exact(value, ['originalDebit', 'appliedDebit', 'outstandingDebit'], 'pendingImmediateDebitAfter')
    return { originalDebit: decimal(value.originalDebit, 'originalDebit'),
      appliedDebit: decimal(value.appliedDebit, 'appliedDebit'),
      outstandingDebit: decimal(value.outstandingDebit, 'outstandingDebit') }
  })()
  const pendingBefore = pending(root.pendingChangeBefore)
  if (request.action === 'cancel') {
    if (targetTerms !== null || !pendingBefore || 'status' in pendingBefore ||
        result !== 'cancelled' || remainder !== null) fail('cancel preview invariants are invalid')
  } else {
    if (!targetTerms || !sameTarget(targetTerms, request)) fail('preview target does not match request')
    if (request.action === 'schedule' && (pendingBefore !== null || result !== 'created'))
      fail('schedule preview invariants are invalid')
    if (request.action === 'replace' && (!pendingBefore || 'status' in pendingBefore ||
        result !== 'replaced')) fail('replace preview invariants are invalid')
    if (request.action === 'apply_immediate' && !['preserved', 'none'].includes(String(result)))
      fail('immediate preview invariants are invalid')
  }
  if (!immediate && (effect.calculation !== null || effect.account !== null || remainder !== null))
    fail('deferred preview contains immediate effects')
  return { schemaVersion: 1, action: request.action, previewToken: root.previewToken as string,
    previewedAt: local(root.previewedAt, 'previewedAt'), currentTerms, targetTerms,
    pendingChangeBefore: pendingBefore,
    pendingResult: result as BillingSubscriptionPlanChangePreview['pendingResult'], effectiveCycle: cycle,
    creditEffect: { timing: effect.timing as 'immediate' | 'next_billing_cycle',
      currentCycleCreditAmount: decimal(effect.currentCycleCreditAmount, 'currentCycleCreditAmount'),
      targetCycleCreditAmount: decimal(effect.targetCycleCreditAmount, 'targetCycleCreditAmount'),
      calculation: immediate ? calculation(effect.calculation) : null,
      account: immediate ? account(effect.account) : null }, pendingImmediateDebitAfter: remainder }
}

const SCHEDULED_KEYS = ['schemaVersion', 'planChangeOperationId', 'clientId', 'subscriptionId',
  'action', 'previousPendingChangeOperationId', 'pendingChangeOperationId', 'planName',
  'cycleCreditAmount', 'entitlements', 'changeEffectivePolicy', 'prorationPolicy',
  'unusedCreditPolicy', 'effectiveCycleIndex', 'effectiveCycleStart', 'effectiveCycleEnd',
  'subscriptionTier', 'tierRevision', 'operationAsOf'] as const
const IMMEDIATE_KEYS = ['schemaVersion', 'planChangeOperationId', 'clientId', 'subscriptionId',
  'action', 'subscriptionTier', 'tierRevision', 'previousPlanTermsOperationId',
  'planTermsOperationId', 'preservedPendingChangeOperationId', 'oldTerms', 'newTerms',
  'calculation', 'account', 'initialEffectOperationId', 'initialLedgerEntryId',
  'immediateRemainderOperationId', 'operationAsOf'] as const

export function parseBillingPlanReceipt(textValue: string, clientIdValue: string,
  subscriptionIdValue: string, request: BillingSubscriptionPlanChangeCommandRequest): BillingSubscriptionPlanChangeReceipt {
  const root = payload(textValue)
  const immediate = request.action === 'apply_immediate'
  exact(root, immediate ? IMMEDIATE_KEYS : SCHEDULED_KEYS, 'receipt')
  const expectedClient = canonicalizeGuid(clientIdValue) ?? fail('clientId is invalid')
  const expectedSubscription = canonicalizeGuid(subscriptionIdValue) ?? fail('subscriptionId is invalid')
  const operation = uuid7(root.planChangeOperationId, 'planChangeOperationId')
  if (!expectedClient || !expectedSubscription || guid(root.clientId, 'clientId') !== expectedClient ||
      guid(root.subscriptionId, 'subscriptionId') !== expectedSubscription ||
      operation !== request.planChangeOperationId || !isLosslessNumber(root.schemaVersion) ||
      root.schemaVersion.toString() !== '2') fail('receipt identity is invalid')
  if (immediate) {
    if (root.action !== 'apply_immediate') fail('receipt action is invalid')
    const oldTerms = terms(root.oldTerms, 'oldTerms')
    const newTerms = terms(root.newTerms, 'newTerms')
    if (!sameTarget(newTerms, request))
      fail('immediate receipt target does not match request')
    return { schemaVersion: 2, planChangeOperationId: operation, clientId: expectedClient,
      subscriptionId: expectedSubscription, action: 'apply_immediate',
      subscriptionTier: tier(root.subscriptionTier), tierRevision: int64(root.tierRevision, 'tierRevision'),
      previousPlanTermsOperationId: uuid7(root.previousPlanTermsOperationId, 'previousPlanTermsOperationId'),
      planTermsOperationId: uuid7(root.planTermsOperationId, 'planTermsOperationId'),
      preservedPendingChangeOperationId: nullable(root.preservedPendingChangeOperationId, uuid7, 'preservedPendingChangeOperationId'),
      oldTerms, newTerms,
      calculation: calculation(root.calculation), account: account(root.account),
      initialEffectOperationId: nullable(root.initialEffectOperationId, uuid7, 'initialEffectOperationId'),
      initialLedgerEntryId: nullable(root.initialLedgerEntryId, guid, 'initialLedgerEntryId'),
      immediateRemainderOperationId: nullable(root.immediateRemainderOperationId, uuid7, 'immediateRemainderOperationId'),
      operationAsOf: local(root.operationAsOf, 'operationAsOf') } satisfies BillingSubscriptionImmediatePlanChangeReceipt
  }
  if (root.action !== (request.action === 'cancel' ? 'cancel' : 'schedule')) fail('receipt action is invalid')
  const receipt = { schemaVersion: 2, planChangeOperationId: operation, clientId: expectedClient,
    subscriptionId: expectedSubscription, action: root.action,
    previousPendingChangeOperationId: nullable(root.previousPendingChangeOperationId, uuid7, 'previousPendingChangeOperationId'),
    pendingChangeOperationId: nullable(root.pendingChangeOperationId, uuid7, 'pendingChangeOperationId'),
    planName: root.planName === null ? null : text(root.planName, 'planName'),
    cycleCreditAmount: root.cycleCreditAmount === null ? null : decimal(root.cycleCreditAmount, 'cycleCreditAmount'),
    entitlements: root.entitlements === null ? null : entitlements(root.entitlements, 'entitlements'),
    changeEffectivePolicy: root.changeEffectivePolicy === null ? null : root.changeEffectivePolicy,
    prorationPolicy: root.prorationPolicy === null ? null : proration(root.prorationPolicy, 'prorationPolicy'),
    unusedCreditPolicy: root.unusedCreditPolicy === null ? null : root.unusedCreditPolicy,
    effectiveCycleIndex: root.effectiveCycleIndex === null ? null : integer(root.effectiveCycleIndex, 'effectiveCycleIndex'),
    effectiveCycleStart: nullable(root.effectiveCycleStart, local, 'effectiveCycleStart'),
    effectiveCycleEnd: nullable(root.effectiveCycleEnd, local, 'effectiveCycleEnd'),
    subscriptionTier: tier(root.subscriptionTier), tierRevision: int64(root.tierRevision, 'tierRevision'),
    operationAsOf: local(root.operationAsOf, 'operationAsOf') }
  if ((receipt.changeEffectivePolicy !== null && receipt.changeEffectivePolicy !== 'next_billing_cycle') ||
      (receipt.unusedCreditPolicy !== null && receipt.unusedCreditPolicy !== 'rollover')) fail('receipt policy is invalid')
  if (request.action === 'cancel') {
    if (receipt.action !== 'cancel' || receipt.previousPendingChangeOperationId === null ||
        receipt.pendingChangeOperationId !== null || receipt.planName !== null ||
        receipt.cycleCreditAmount !== null || receipt.entitlements !== null ||
        receipt.changeEffectivePolicy !== null || receipt.prorationPolicy !== null ||
        receipt.unusedCreditPolicy !== null || receipt.effectiveCycleIndex !== null ||
        receipt.effectiveCycleStart !== null || receipt.effectiveCycleEnd !== null)
      fail('cancel receipt invariants are invalid')
  } else {
    if (receipt.action !== 'schedule' || receipt.pendingChangeOperationId !== operation ||
        receipt.planName !== request.planName || receipt.cycleCreditAmount !== request.cycleCreditAmount ||
        !receipt.entitlements || !sameEntitlements(receipt.entitlements, request.entitlements) ||
        receipt.changeEffectivePolicy !== 'next_billing_cycle' ||
        receipt.prorationPolicy !== request.prorationPolicy ||
        receipt.unusedCreditPolicy !== request.unusedCreditPolicy ||
        receipt.effectiveCycleIndex === null || receipt.effectiveCycleStart === null ||
        receipt.effectiveCycleEnd === null ||
        (request.action === 'schedule' && receipt.previousPendingChangeOperationId !== null) ||
        (request.action === 'replace' && receipt.previousPendingChangeOperationId === null))
      fail('schedule receipt invariants are invalid')
  }
  return receipt as BillingSubscriptionScheduledPlanChangeReceipt
}

function requireActor(): string {
  const actor = useAuthStore.getState().user?.id
  return actor ?? fail('authenticated actor is unavailable')
}
function verifyActor(actor: string): void {
  if (useAuthStore.getState().user?.id !== actor) fail('authenticated actor changed')
}

export async function previewBillingPlanChange(clientId: string, subscriptionId: string,
  request: BillingSubscriptionPlanChangePreviewRequest, signal?: AbortSignal): Promise<BillingSubscriptionPlanChangePreview> {
  const client = canonicalizeGuid(clientId) ?? fail('route clientId is invalid')
  const subscription = canonicalizeGuid(subscriptionId) ?? fail('route subscriptionId is invalid')
  const actor = requireActor(); const body = serializeBillingPlanPreviewRequest(request)
  const response = await apiClient.postApiRoot<string>(
    `/api/backoffice/clients/${client}/billing/subscriptions/${subscription}/changes/preview`, body,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' } })
  verifyActor(actor)
  if (response.status !== 200 || typeof response.data !== 'string') fail('preview response is invalid')
  return parseBillingPlanPreview(response.data, request)
}

export async function postBillingPlanChange(clientId: string, subscriptionId: string,
  request: BillingSubscriptionPlanChangeCommandRequest, signal?: AbortSignal,
  retainedBody?: string, onAuthReplay?: () => void): Promise<BillingSubscriptionPlanChangeReceipt> {
  const client = canonicalizeGuid(clientId) ?? fail('route clientId is invalid')
  const subscription = canonicalizeGuid(subscriptionId) ?? fail('route subscriptionId is invalid')
  const body = retainedBody ?? serializeBillingPlanCommandRequest(request)
  if (retainedBody !== undefined && retainedBody !== serializeBillingPlanCommandRequest(request))
    fail('retained command bytes changed')
  const actor = requireActor()
  const response = await apiClient.postApiRoot<string>(
    `/api/backoffice/clients/${client}/billing/subscriptions/${subscription}/changes`, body,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}) })
  verifyActor(actor)
  if (response.status !== 200 || typeof response.data !== 'string') fail('command response is invalid')
  return parseBillingPlanReceipt(response.data, client, subscription, request)
}
