import { isLosslessNumber, parse } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import {
  BILLING_LEDGER_TRANSACTION_TYPES,
  type BillingAccountSnapshot,
  type BillingAccountStatus,
  type BillingLedgerFilters,
  type BillingLedgerItem,
  type BillingLedgerPage,
  type BillingLedgerPageRequest,
  type BillingLedgerTransactionType,
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
] as const

const DECIMAL_18_4_PATTERN = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const UTC_OFFSET_PATTERN = /(Z|\+00:00)$/i
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

export const billingApi = {
  getAccountSnapshot: getBillingAccountSnapshot,
  getLedgerPage: getBillingLedgerPage,
}
