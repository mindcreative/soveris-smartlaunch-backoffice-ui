import { isLosslessNumber, parse } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import type { BillingAccountSnapshot, BillingAccountStatus } from '../types/billing'

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

export class BillingContractError extends Error {
  constructor(reason: string) {
    super(`Invalid Billing snapshot: ${reason}`)
    this.name = 'BillingContractError'
  }
}

function contractError(reason: string): BillingContractError {
  return new BillingContractError(reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

export const billingApi = { getAccountSnapshot: getBillingAccountSnapshot }
