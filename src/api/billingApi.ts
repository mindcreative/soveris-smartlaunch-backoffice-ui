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
  type BillingLedgerExportAccepted,
  type BillingLedgerExportAttempt,
  type BillingLedgerExportFailureCode,
  type BillingLedgerExportFilters,
  type BillingLedgerExportReference,
  type BillingLedgerExportStatus,
  type BillingLedgerExportStatusMetadata,
  type BillingLedgerExportStatusResult,
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
  if (BigInt(lexeme) > 9_223_372_036_854_775_807n) {
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

export const billingApi = {
  getAccountSnapshot: getBillingAccountSnapshot,
  getLedgerPage: getBillingLedgerPage,
  requestLedgerExport: requestBillingLedgerExport,
  getLedgerExportStatus: getBillingLedgerExportStatus,
  redeemLedgerExport: redeemBillingLedgerExport,
}
