import { isLosslessNumber, LosslessNumber, parse, stringify } from 'lossless-json'
import { apiClient, type ApiResponse } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { useAuthStore } from '../stores/authStore'
import type {
  CreditAdjustmentCommandRequest,
  CreditAdjustmentHistoryItem,
  CreditAdjustmentHistoryPage,
  CreditAdjustmentMaterial,
  CreditAdjustmentPreview,
  CreditAdjustmentReceipt,
} from '../types/billing'

const REQUEST_DECIMAL = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const RESPONSE_DECIMAL = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/
const UINT64 = /^(?:0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|([+-])(\d{2}):(\d{2}))$/
const INT64_MAX = 9_223_372_036_854_775_807n
const DECIMAL_MAX_SCALED = 999_999_999_999_999_999n
const MAX_BODY_BYTES = 16 * 1024

export class BillingAdjustmentContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing credit-adjustment contract: ${reason}`)
    this.name = 'BillingAdjustmentContractError'
  }
}

type JsonRecord = Record<string, unknown>
const fail = (reason: string): never => { throw new BillingAdjustmentContractError(reason) }
const record = (value: unknown, field: string): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : fail(`${field} must be an object`)
const exact = (value: JsonRecord, keys: readonly string[], field: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    fail(`${field} fields are invalid`)
}
const text = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : fail(`${field} must be text`)
const guid = (value: unknown, field: string): string => {
  const candidate = text(value, field).toLowerCase()
  return UUID.test(candidate) && candidate !== '00000000-0000-0000-0000-000000000000'
    ? candidate : fail(`${field} must be a non-empty canonical GUID`)
}
const uuid7 = (value: unknown, field: string): string => {
  const candidate = guid(value, field)
  return UUID_V7.test(candidate) ? candidate : fail(`${field} must be RFC 9562 UUIDv7`)
}
const instant = (value: unknown, field: string): string => {
  const candidate = text(value, field)
  const match = UTC_INSTANT.exec(candidate)
  if (!match) return fail(`${field} must be an offset timestamp`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === undefined ? 0 : Number(match[8])
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
      hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0) || Number.isNaN(Date.parse(candidate)))
    fail(`${field} must be an offset timestamp`)
  return candidate
}
const schemaVersion = (value: unknown, field: string): 1 => {
  if (!isLosslessNumber(value) || value.toString() !== '1') fail(`${field} must be 1`)
  return 1
}
const decimal = (value: unknown, field: string, stored = true): string => {
  if (!isLosslessNumber(value)) fail(`${field} must be an exact JSON number`)
  const candidate = (value as LosslessNumber).toString()
  if (!RESPONSE_DECIMAL.test(candidate)) fail(`${field} is not an exact credit value`)
  if (stored && abs(scaled(candidate)) > DECIMAL_MAX_SCALED)
    fail(`${field} is outside DECIMAL(18,4)`)
  return candidate
}
const int64 = (value: unknown, field: string): string => {
  if (!isLosslessNumber(value)) fail(`${field} must be an exact JSON integer`)
  const candidate = (value as LosslessNumber).toString()
  if (!UINT64.test(candidate) || BigInt(candidate) > INT64_MAX) fail(`${field} is outside signed BIGINT`)
  return candidate
}
const nullableGuid = (value: unknown, field: string): string | null =>
  value === null ? null : guid(value, field)

function scaled(value: string): bigint {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const result = BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'))
  return negative ? -result : result
}
const abs = (value: bigint): bigint => value < 0n ? -value : value
const sameDecimal = (left: string, right: string): boolean => scaled(left) === scaled(right)

function validReason(value: unknown): string {
  const reason = text(value, 'reason')
  if (reason !== reason.trim() || [...reason].length < 1 || [...reason].length > 512 ||
      /\p{Cc}/u.test(reason) || /[\uD800-\uDFFF]/u.test(reason))
    fail('reason must be trimmed, contain 1–512 Unicode scalars, and contain no controls')
  return reason
}

function requestAmount(value: unknown): string {
  const amount = text(value, 'amount')
  if (!REQUEST_DECIMAL.test(amount) || scaled(amount) === 0n)
    fail('amount must be a non-zero DECIMAL(18,4) token')
  return amount
}

function requestVersion(value: unknown): string {
  const version = text(value, 'expectedWalletVersion')
  if (!UINT64.test(version) || BigInt(version) > INT64_MAX) fail('expectedWalletVersion is outside signed BIGINT')
  return version
}

function ensureBodySize(body: string): string {
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) fail('request body exceeds 16 KiB')
  return body
}

function assertNoDuplicateObjectKeys(source: string): void {
  let index = 0
  const whitespace = () => { while (/\s/.test(source[index] ?? '')) index += 1 }
  const stringToken = (): string => {
    const start = index
    if (source[index++] !== '"') fail('response contains invalid JSON')
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue }
      if (source[index++] === '"') {
        try { return JSON.parse(source.slice(start, index)) as string }
        catch { return fail('response contains invalid JSON string') }
      }
    }
    return fail('response contains an unterminated JSON string')
  }
  const value = (): void => {
    whitespace()
    if (source[index] === '{') {
      index += 1; whitespace()
      const keys = new Set<string>()
      if (source[index] === '}') { index += 1; return }
      while (index < source.length) {
        const key = stringToken()
        if (keys.has(key)) fail('response contains a duplicate property')
        keys.add(key); whitespace()
        if (source[index++] !== ':') fail('response contains invalid JSON object')
        value(); whitespace()
        if (source[index] === '}') { index += 1; return }
        if (source[index++] !== ',') fail('response contains invalid JSON object')
        whitespace()
      }
      fail('response contains an unterminated JSON object')
    }
    if (source[index] === '[') {
      index += 1; whitespace()
      if (source[index] === ']') { index += 1; return }
      while (index < source.length) {
        value(); whitespace()
        if (source[index] === ']') { index += 1; return }
        if (source[index++] !== ',') fail('response contains invalid JSON array')
      }
      fail('response contains an unterminated JSON array')
    }
    if (source[index] === '"') { stringToken(); return }
    const start = index
    while (index < source.length && !/[\s,}\]]/.test(source[index]!)) index += 1
    if (index === start) fail('response contains invalid JSON value')
  }
  value(); whitespace()
  if (index !== source.length) fail('response contains trailing JSON content')
}

function payload(source: string): JsonRecord {
  try {
    assertNoDuplicateObjectKeys(source)
    return record(parse(source), 'response')
  } catch (error) {
    if (error instanceof BillingAdjustmentContractError) throw error
    return fail('response is not valid lossless JSON')
  }
}

function validateStoredEquations(values: {
  amount: string
  beforeOwnedBalance: string
  beforeReservedBalance: string
  beforeAvailableBalance: string
  afterOwnedBalance: string
  afterReservedBalance: string
  afterAvailableBalance: string
}): void {
  const amount = scaled(values.amount)
  const beforeOwned = scaled(values.beforeOwnedBalance)
  const beforeReserved = scaled(values.beforeReservedBalance)
  const beforeAvailable = scaled(values.beforeAvailableBalance)
  const afterOwned = scaled(values.afterOwnedBalance)
  const afterReserved = scaled(values.afterReservedBalance)
  const afterAvailable = scaled(values.afterAvailableBalance)
  if (beforeReserved < 0n || beforeOwned < beforeReserved || beforeAvailable !== beforeOwned - beforeReserved ||
      afterReserved !== beforeReserved || afterOwned !== beforeOwned + amount ||
      afterAvailable !== afterOwned - afterReserved || afterOwned < afterReserved)
    fail('balance equations are impossible')
}

export function serializeCreditAdjustmentPreviewRequest(request: CreditAdjustmentMaterial): string {
  exact(record(request, 'preview request'), ['amount', 'reason'], 'preview request')
  const amount = requestAmount(request.amount)
  const reason = validReason(request.reason)
  return ensureBodySize(stringify({ amount: new LosslessNumber(amount), reason }) as string)
}

export function serializeCreditAdjustmentCommandRequest(request: CreditAdjustmentCommandRequest): string {
  exact(record(request, 'command request'),
    ['operationId', 'expectedWalletVersion', 'amount', 'reason'], 'command request')
  const operationId = uuid7(request.operationId, 'operationId')
  const expectedWalletVersion = requestVersion(request.expectedWalletVersion)
  const amount = requestAmount(request.amount)
  const reason = validReason(request.reason)
  return ensureBodySize(stringify({ operationId,
    expectedWalletVersion: new LosslessNumber(expectedWalletVersion),
    amount: new LosslessNumber(amount), reason }) as string)
}

const PREVIEW_KEYS = ['schemaVersion', 'clientId', 'creditAccountId', 'walletVersion', 'asOf',
  'amount', 'currentOwnedBalance', 'currentReservedBalance', 'currentAvailableBalance',
  'projectedOwnedBalance', 'projectedReservedBalance', 'projectedAvailableBalance',
  'maximumSafeDebit', 'minimumAllowedAmount', 'walletInvariantEligible', 'ineligibilityCode'] as const

export function parseCreditAdjustmentPreview(source: string, clientIdValue: string,
  creditAccountIdValue: string, request: CreditAdjustmentMaterial): CreditAdjustmentPreview {
  const root = payload(source)
  exact(root, PREVIEW_KEYS, 'preview')
  const expectedClient = canonicalizeGuid(clientIdValue) ?? fail('route clientId is invalid')
  const expectedAccount = canonicalizeGuid(creditAccountIdValue) ?? fail('account is invalid')
  const clientId = guid(root.clientId, 'clientId')
  const creditAccountId = guid(root.creditAccountId, 'creditAccountId')
  const amount = decimal(root.amount, 'amount')
  const currentOwnedBalance = decimal(root.currentOwnedBalance, 'currentOwnedBalance')
  const currentReservedBalance = decimal(root.currentReservedBalance, 'currentReservedBalance')
  const currentAvailableBalance = decimal(root.currentAvailableBalance, 'currentAvailableBalance')
  const projectedOwnedBalance = decimal(root.projectedOwnedBalance, 'projectedOwnedBalance', false)
  const projectedReservedBalance = decimal(root.projectedReservedBalance, 'projectedReservedBalance')
  const projectedAvailableBalance = decimal(root.projectedAvailableBalance, 'projectedAvailableBalance', false)
  const maximumSafeDebit = decimal(root.maximumSafeDebit, 'maximumSafeDebit')
  const minimumAllowedAmount = decimal(root.minimumAllowedAmount, 'minimumAllowedAmount')
  if (typeof root.walletInvariantEligible !== 'boolean') fail('preview eligibility must be boolean')
  const eligible = root.walletInvariantEligible as boolean
  const code = root.ineligibilityCode
  if (clientId !== expectedClient || creditAccountId !== expectedAccount ||
      !sameDecimal(amount, requestAmount(request.amount)) ||
      (eligible ? code !== null : code !== 'insufficient_available_credits' && code !== 'projected_balance_out_of_range'))
    fail('preview identity or eligibility is invalid')
  const currentOwned = scaled(currentOwnedBalance)
  const currentReserved = scaled(currentReservedBalance)
  const currentAvailable = scaled(currentAvailableBalance)
  const projectedOwned = scaled(projectedOwnedBalance)
  const projectedReserved = scaled(projectedReservedBalance)
  const projectedAvailable = scaled(projectedAvailableBalance)
  if (currentReserved < 0n || currentOwned < currentReserved ||
      currentAvailable !== currentOwned - currentReserved ||
      projectedOwned !== currentOwned + scaled(amount) || projectedReserved !== currentReserved ||
      projectedAvailable !== projectedOwned - projectedReserved ||
      scaled(maximumSafeDebit) !== currentAvailable || scaled(minimumAllowedAmount) !== -currentAvailable ||
      (eligible && (projectedOwned < projectedReserved || abs(projectedOwned) > DECIMAL_MAX_SCALED)) ||
      (!eligible && code === 'insufficient_available_credits' && projectedOwned >= projectedReserved) ||
      (!eligible && code === 'projected_balance_out_of_range' && abs(projectedOwned) <= DECIMAL_MAX_SCALED))
    fail('preview balance equations or eligibility evidence are impossible')
  return {
    schemaVersion: schemaVersion(root.schemaVersion, 'schemaVersion'), clientId,
    creditAccountId,
    walletVersion: int64(root.walletVersion, 'walletVersion'), asOf: instant(root.asOf, 'asOf'),
    amount, reason: request.reason, currentOwnedBalance, currentReservedBalance,
    currentAvailableBalance, projectedOwnedBalance, projectedReservedBalance,
    projectedAvailableBalance, maximumSafeDebit, minimumAllowedAmount,
    walletInvariantEligible: eligible, ineligibilityCode: code as CreditAdjustmentPreview['ineligibilityCode'],
  }
}

const RECEIPT_KEYS = ['schemaVersion', 'operationId', 'adjustmentId', 'ledgerId', 'clientId',
  'creditAccountId', 'amount', 'reason', 'performedBy', 'walletVersionBefore',
  'walletVersionAfter', 'beforeOwnedBalance', 'beforeReservedBalance', 'beforeAvailableBalance',
  'afterOwnedBalance', 'afterReservedBalance', 'afterAvailableBalance', 'operationAsOf'] as const

function receipt(root: JsonRecord, clientIdValue: string, creditAccountIdValue: string, actorIdValue: string,
  request: CreditAdjustmentCommandRequest): CreditAdjustmentReceipt {
  exact(root, RECEIPT_KEYS, 'receipt')
  const expectedClient = canonicalizeGuid(clientIdValue) ?? fail('route clientId is invalid')
  const expectedAccount = canonicalizeGuid(creditAccountIdValue) ?? fail('account is invalid')
  const expectedActor = canonicalizeGuid(actorIdValue) ?? fail('actor is invalid')
  const amount = decimal(root.amount, 'amount')
  const walletVersionBefore = int64(root.walletVersionBefore, 'walletVersionBefore')
  const walletVersionAfter = int64(root.walletVersionAfter, 'walletVersionAfter')
  const result: CreditAdjustmentReceipt = {
    schemaVersion: schemaVersion(root.schemaVersion, 'schemaVersion'),
    operationId: uuid7(root.operationId, 'operationId'), adjustmentId: guid(root.adjustmentId, 'adjustmentId'),
    ledgerId: guid(root.ledgerId, 'ledgerId'), clientId: guid(root.clientId, 'clientId'),
    creditAccountId: guid(root.creditAccountId, 'creditAccountId'), amount,
    reason: validReason(root.reason), performedBy: guid(root.performedBy, 'performedBy'),
    walletVersionBefore, walletVersionAfter,
    beforeOwnedBalance: decimal(root.beforeOwnedBalance, 'beforeOwnedBalance'),
    beforeReservedBalance: decimal(root.beforeReservedBalance, 'beforeReservedBalance'),
    beforeAvailableBalance: decimal(root.beforeAvailableBalance, 'beforeAvailableBalance'),
    afterOwnedBalance: decimal(root.afterOwnedBalance, 'afterOwnedBalance'),
    afterReservedBalance: decimal(root.afterReservedBalance, 'afterReservedBalance'),
    afterAvailableBalance: decimal(root.afterAvailableBalance, 'afterAvailableBalance'),
    operationAsOf: instant(root.operationAsOf, 'operationAsOf'),
  }
  if (result.clientId !== expectedClient || result.creditAccountId !== expectedAccount ||
      result.performedBy !== expectedActor ||
      result.operationId !== request.operationId || result.reason !== request.reason ||
      !sameDecimal(result.amount, request.amount) || walletVersionBefore !== request.expectedWalletVersion ||
      BigInt(walletVersionBefore) === INT64_MAX || BigInt(walletVersionAfter) !== BigInt(walletVersionBefore) + 1n)
    fail('receipt identity or command evidence is invalid')
  validateStoredEquations(result)
  return result
}

export function parseCreditAdjustmentReceipt(source: string, clientIdValue: string,
  creditAccountIdValue: string, actorIdValue: string,
  request: CreditAdjustmentCommandRequest): CreditAdjustmentReceipt {
  return receipt(payload(source), clientIdValue, creditAccountIdValue, actorIdValue, request)
}

const HISTORY_KEYS = ['schemaVersion', 'clientId', 'creditAccountId', 'operationId',
  'adjustmentId', 'ledgerId', 'operationType', 'amount', 'reason', 'performedBy',
  'expectedWalletVersion', 'walletVersionBefore', 'walletVersionAfter', 'beforeOwnedBalance',
  'beforeReservedBalance', 'beforeAvailableBalance', 'afterOwnedBalance', 'afterReservedBalance',
  'afterAvailableBalance', 'operationAsOf', 'originalAdjustmentId', 'reversalAdjustmentId'] as const

export function parseCreditAdjustmentHistory(source: string, clientIdValue: string,
  actorIdValue: string, request: CreditAdjustmentCommandRequest,
  creditAccountIdValue: string): CreditAdjustmentHistoryPage {
  const root = payload(source)
  exact(root, ['items', 'asOf', 'nextCursor'], 'history')
  if (!Array.isArray(root.items) || root.items.length > 1 || root.nextCursor !== null)
    fail('history envelope is invalid')
  const rawItems = root.items as unknown[]
  const expectedAccount = canonicalizeGuid(creditAccountIdValue) ?? fail('account is invalid')
  const items = rawItems.map((entry): CreditAdjustmentHistoryItem => {
    const item = record(entry, 'history item')
    exact(item, HISTORY_KEYS, 'history item')
    if (item.operationType !== 'original' || item.originalAdjustmentId !== null)
      fail('history item is not original adjustment evidence')
    const receiptRoot: JsonRecord = Object.fromEntries(RECEIPT_KEYS.map((key) => [key, item[key]]))
    const parsedReceipt = receipt(receiptRoot, clientIdValue, creditAccountIdValue, actorIdValue, request)
    const expectedWalletVersion = int64(item.expectedWalletVersion, 'expectedWalletVersion')
    if (parsedReceipt.creditAccountId !== expectedAccount ||
        expectedWalletVersion !== request.expectedWalletVersion ||
        expectedWalletVersion !== parsedReceipt.walletVersionBefore)
      fail('history item does not match retained command evidence')
    return { ...parsedReceipt, operationType: 'original', expectedWalletVersion,
      originalAdjustmentId: null,
      reversalAdjustmentId: nullableGuid(item.reversalAdjustmentId, 'reversalAdjustmentId') }
  })
  return { items, asOf: instant(root.asOf, 'asOf'), nextCursor: null }
}

function requireActor(): string {
  return useAuthStore.getState().user?.id ?? fail('authenticated actor is unavailable')
}
function verifyActor(actor: string): void {
  if (useAuthStore.getState().user?.id !== actor) fail('authenticated actor changed')
}
function requireJson(response: ApiResponse<string>, field: string): string {
  const headers = response.headers as { get?: (name: string) => unknown; [key: string]: unknown } | undefined
  const contentType = headers?.get?.('content-type') ?? headers?.['content-type']
  if (response.status !== 200 || typeof response.data !== 'string' ||
      typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
    fail(`${field} response status or media type is invalid`)
  return response.data
}

export async function previewCreditAdjustment(clientIdValue: string,
  creditAccountIdValue: string, request: CreditAdjustmentMaterial, signal?: AbortSignal,
  onAuthReplay?: () => void): Promise<CreditAdjustmentPreview> {
  const clientId = canonicalizeGuid(clientIdValue) ?? fail('route clientId is invalid')
  const actor = requireActor()
  const body = serializeCreditAdjustmentPreviewRequest(request)
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${encodeURIComponent(clientId)}/credit-adjustments/preview`, body,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}) })
  verifyActor(actor)
  return parseCreditAdjustmentPreview(requireJson(response, 'preview'), clientId,
    creditAccountIdValue, request)
}

export async function postCreditAdjustment(clientIdValue: string,
  creditAccountIdValue: string, request: CreditAdjustmentCommandRequest,
  signal?: AbortSignal, retainedBody?: string,
  onAuthReplay?: () => void): Promise<CreditAdjustmentReceipt> {
  const clientId = canonicalizeGuid(clientIdValue) ?? fail('route clientId is invalid')
  const serialized = serializeCreditAdjustmentCommandRequest(request)
  if (retainedBody !== undefined && retainedBody !== serialized) fail('retained command bytes changed')
  const actor = requireActor()
  const response = await apiClient.postApiRoot<string>(
    `/api/billing/clients/${encodeURIComponent(clientId)}/credit-adjustments`, retainedBody ?? serialized,
    { responseType: 'text', signal, headers: { 'Content-Type': 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}) })
  verifyActor(actor)
  return parseCreditAdjustmentReceipt(requireJson(response, 'command'), clientId,
    creditAccountIdValue, actor, request)
}

export async function getCreditAdjustmentOperation(clientIdValue: string, operationIdValue: string,
  actorIdValue: string, request: CreditAdjustmentCommandRequest, creditAccountIdValue: string,
  signal?: AbortSignal, onAuthReplay?: () => void): Promise<CreditAdjustmentHistoryPage> {
  const clientId = canonicalizeGuid(clientIdValue) ?? fail('route clientId is invalid')
  const operationId = uuid7(operationIdValue, 'operationId')
  const actor = requireActor()
  if (actor !== canonicalizeGuid(actorIdValue)) fail('retained actor does not match active actor')
  const response = await apiClient.getApiRoot<string>(
    `/api/billing/clients/${encodeURIComponent(clientId)}/adjustments?operationId=${encodeURIComponent(operationId)}&pageSize=1`,
    { responseType: 'text', signal, headers: { Accept: 'application/json' },
      ...(onAuthReplay ? { onAuthReplay } : {}) })
  verifyActor(actor)
  return parseCreditAdjustmentHistory(requireJson(response, 'history'), clientId, actor,
    request, creditAccountIdValue)
}
