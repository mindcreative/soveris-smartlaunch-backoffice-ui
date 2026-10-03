import { isLosslessNumber, parse } from 'lossless-json'
import { apiClient, type ApiError } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { useAuthStore } from '../stores/authStore'
import {
  AI_IMAGE_JOB_STATUSES,
  AI_IMAGE_TARGET_ROLES,
  type AiImageAdmissionQuote,
  type AiImageAdmissionReceipt,
  type AiImageGenerationRequest,
  type AiImageGuidance,
  type AiImageJob,
  type AiImageJobStatus,
  type AiImageProblem,
  type AiImageReservation,
  type AiImageResult,
  type AiImageResultAccess,
  type AiImageTargetRole,
} from '../types/aiImages'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DECIMAL = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const ABSOLUTE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(?:Z|\+00:00)$/
const REQUEST_KEYS = ['idempotencyKey', 'prompt', 'targetRole', 'quoteId'] as const
const QUOTE_RESPONSE_KEYS = ['quoteId', 'operation', 'targetRole', 'quotedCredits', 'ruleVersion', 'issuedAt', 'expiresAt'] as const
const ADMISSION_KEYS = ['jobId', 'reservationId', 'eventId', 'quotedCredits', 'status', 'correlationId', 'replay'] as const
const JOB_KEYS = ['jobId', 'clientId', 'requestType', 'targetRole', 'status', 'attemptCount', 'createdAt', 'updatedAt', 'processingStartedAt', 'lastAttemptCompletedAt', 'completedAt', 'quote', 'reservation', 'result', 'resultAccess', 'guidance'] as const
const QUOTE_KEYS = ['credits', 'ruleVersion'] as const
const RESERVATION_KEYS = ['reservationId', 'state', 'estimatedCredits', 'actualCredits', 'createdAt', 'expiresAt', 'committedAt', 'releasedAt'] as const
const RESULT_KEYS = ['resultId', 'mediaType', 'width', 'height', 'byteSize', 'observedAt', 'createdAt', 'expiresAt'] as const
const ACCESS_KEYS = ['reference', 'expiresAt'] as const
const GUIDANCE_KEYS = ['code', 'poll'] as const

export function isCanonicalUuidV7(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_V7.test(value)
}

export class AiImageContractError extends Error {
  constructor(reason: string) {
    super(`Invalid AI image contract: ${reason}`)
    this.name = 'AiImageContractError'
  }
}

function invalid(reason: string): never { throw new AiImageContractError(reason) }
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isLosslessNumber(value))
    invalid(`${field} must be an object`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]))
    invalid(`${field} fields do not match the closed contract`)
}
function assertNoDuplicateObjectKeys(source: string): void {
  const stack: Array<Set<string> | null> = []
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') { stack.push(new Set()); continue }
    if (character === '[') { stack.push(null); continue }
    if (character === '}' || character === ']') { stack.pop(); continue }
    if (character !== '"') continue
    const start = index
    let escaped = false
    for (index += 1; index < source.length; index += 1) {
      const next = source[index]!
      if (escaped) escaped = false
      else if (next === '\\') escaped = true
      else if (next === '"') break
    }
    let following = index + 1
    while (following < source.length && /\s/u.test(source[following]!)) following += 1
    const keys = stack[stack.length - 1]
    if (source[following] !== ':' || !(keys instanceof Set)) continue
    let key: string
    try { key = JSON.parse(source.slice(start, index + 1)) as string }
    catch { continue }
    if (keys.has(key)) invalid('response contains a duplicate object property')
    keys.add(key)
  }
}
function parseObject(body: string, field: string): Record<string, unknown> {
  try {
    assertNoDuplicateObjectKeys(body)
    return record(parse(body), field)
  }
  catch (error) {
    if (error instanceof AiImageContractError) throw error
    return invalid(`${field} is not valid JSON`)
  }
}
function uuid7(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V7.test(value)) invalid(`${field} must be a canonical UUIDv7`)
  return value
}
function guid(value: unknown, field: string): string {
  const parsed = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!parsed || parsed !== value) invalid(`${field} must be a canonical GUID`)
  return parsed
}
function text(value: unknown, field: string, maximum = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) invalid(`${field} must be bounded nonblank text`)
  return value
}
function instant(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !ABSOLUTE_INSTANT.test(value) || !Number.isFinite(Date.parse(value)))
    invalid(`${field} must be an offset-bearing instant`)
  return value
}
function integer(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const lexeme = isLosslessNumber(value) ? value.toString() : typeof value === 'number' ? String(value) : ''
  if (!/^\d+$/.test(lexeme)) invalid(`${field} must be a non-negative integer`)
  const number = Number(lexeme)
  if (!Number.isSafeInteger(number) || number > maximum) invalid(`${field} is outside its bound`)
  return number
}
function decimal(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (!isLosslessNumber(value)) invalid(`${field} must be a JSON decimal number`)
  const result = value.toString()
  if (!DECIMAL.test(result)) invalid(`${field} is outside the decimal contract`)
  return result
}
function positiveDecimal(value: unknown, field: string): string {
  const result = decimal(value, field)!
  const [whole, fractional = ''] = result.split('.')
  const scaled = BigInt(whole!) * 10_000n + BigInt(fractional.padEnd(4, '0'))
  if (scaled <= 0n) invalid(`${field} must be positive`)
  return result
}
function opaqueQuoteId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 16_384 || /\s|[\u0000-\u001f\u007f]/u.test(value))
    invalid('quoteId must be bounded opaque text')
  return value
}
function boundedRuleVersion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value))
    invalid('ruleVersion must be bounded nonblank text')
  return value
}
function canonicalUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(`${field} must be a canonical UTC instant`)
  const match = UTC_INSTANT.exec(value)
  if (!match) invalid(`${field} must be a canonical UTC instant`)
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const check = new Date(0)
  check.setUTCFullYear(year!, month! - 1, day!)
  check.setUTCHours(hour!, minute!, second!, 0)
  if (year! < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month! - 1 ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute ||
      check.getUTCSeconds() !== second || !Number.isFinite(Date.parse(value)))
    invalid(`${field} must be a canonical UTC instant`)
  return value
}
function sameDecimal(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value
  return normalize(left) === normalize(right)
}
function at(value: string): number { return Date.parse(value) }
function notBefore(later: string | null, earlier: string | null): boolean {
  return later === null || earlier === null || at(later) >= at(earlier)
}
function actor(): string {
  const actorId = useAuthStore.getState().user?.id
  if (!actorId) return invalid('authenticated actor is unavailable')
  return actorId
}
function requireActor(expected: string): void {
  if (useAuthStore.getState().user?.id !== expected) invalid('authenticated actor changed while loading')
}

export function serializeAiImageRequest(request: AiImageGenerationRequest): string {
  const value = record(request, 'request')
  exact(value, REQUEST_KEYS, 'request')
  uuid7(request.idempotencyKey, 'idempotencyKey')
  if (!AI_IMAGE_TARGET_ROLES.includes(request.targetRole)) invalid('targetRole is unsupported')
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  if (prompt.length < 1 || prompt.length > 4_000) invalid('prompt is outside its bound')
  const quoteId = opaqueQuoteId(request.quoteId)
  return JSON.stringify({ idempotencyKey: request.idempotencyKey, prompt, targetRole: request.targetRole, quoteId })
}

export function serializeAiImageQuoteRequest(targetRole: AiImageTargetRole): string {
  if (!AI_IMAGE_TARGET_ROLES.includes(targetRole)) invalid('targetRole is unsupported')
  return JSON.stringify({ targetRole })
}

export function parseAiImageAdmissionQuote(body: string, requestedRole: AiImageTargetRole): AiImageAdmissionQuote {
  if (!AI_IMAGE_TARGET_ROLES.includes(requestedRole)) return invalid('requested targetRole is unsupported')
  const payload = parseObject(body, 'quote response')
  exact(payload, QUOTE_RESPONSE_KEYS, 'quote response')
  if (payload.operation !== 'image_generation') invalid('quote operation is unsupported')
  if (payload.targetRole !== requestedRole) invalid('quote targetRole does not match the request')
  const issuedAt = canonicalUtcInstant(payload.issuedAt, 'issuedAt')
  const expiresAt = canonicalUtcInstant(payload.expiresAt, 'expiresAt')
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) invalid('quote validity window is inconsistent')
  return {
    quoteId: opaqueQuoteId(payload.quoteId),
    operation: 'image_generation',
    targetRole: requestedRole,
    quotedCredits: positiveDecimal(payload.quotedCredits, 'quotedCredits'),
    ruleVersion: boundedRuleVersion(payload.ruleVersion),
    issuedAt,
    expiresAt,
  }
}

export function parseAiImageAdmission(body: string, status: number): AiImageAdmissionReceipt {
  if (status !== 202) return invalid('admission HTTP status must be 202')
  const payload = parseObject(body, 'admission response')
  exact(payload, ADMISSION_KEYS, 'admission response')
  const admittedStatus = text(payload.status, 'status', 32)
  if (admittedStatus !== 'reserved') invalid('admission status is unsupported')
  if (typeof payload.replay !== 'boolean') invalid('replay must be boolean')
  return {
    jobId: uuid7(payload.jobId, 'jobId'),
    reservationId: uuid7(payload.reservationId, 'reservationId'),
    eventId: uuid7(payload.eventId, 'eventId'),
    quotedCredits: decimal(payload.quotedCredits, 'quotedCredits')!,
    status: admittedStatus,
    correlationId: uuid7(payload.correlationId, 'correlationId'),
    replay: payload.replay,
  }
}

function parseReservation(value: unknown): AiImageReservation {
  const item = record(value, 'reservation')
  exact(item, RESERVATION_KEYS, 'reservation')
  if (!['active', 'committed', 'released', 'expired'].includes(String(item.state))) invalid('reservation state is unsupported')
  return {
    reservationId: uuid7(item.reservationId, 'reservationId'),
    state: item.state as AiImageReservation['state'],
    estimatedCredits: decimal(item.estimatedCredits, 'estimatedCredits')!,
    actualCredits: decimal(item.actualCredits, 'actualCredits', true),
    createdAt: instant(item.createdAt, 'reservation.createdAt')!,
    expiresAt: instant(item.expiresAt, 'reservation.expiresAt')!,
    committedAt: instant(item.committedAt, 'reservation.committedAt', true),
    releasedAt: instant(item.releasedAt, 'reservation.releasedAt', true),
  }
}
function parseResult(value: unknown): AiImageResult | null {
  if (value === null) return null
  const item = record(value, 'result')
  exact(item, RESULT_KEYS, 'result')
  if (item.mediaType !== 'image/webp') invalid('result mediaType must be image/webp')
  const width = integer(item.width, 'width', 100_000)
  const height = integer(item.height, 'height', 100_000)
  const byteSize = integer(item.byteSize, 'byteSize')
  if (width < 1 || height < 1 || byteSize < 1) invalid('result dimensions and byte size must be positive')
  return {
    resultId: uuid7(item.resultId, 'resultId'), mediaType: 'image/webp',
    width, height, byteSize,
    observedAt: instant(item.observedAt, 'result.observedAt')!,
    createdAt: instant(item.createdAt, 'result.createdAt')!,
    expiresAt: instant(item.expiresAt, 'result.expiresAt')!,
  }
}
function parseAccess(value: unknown): AiImageResultAccess | null {
  if (value === null) return null
  const item = record(value, 'resultAccess')
  exact(item, ACCESS_KEYS, 'resultAccess')
  return { reference: text(item.reference, 'reference', 4096), expiresAt: instant(item.expiresAt, 'resultAccess.expiresAt')! }
}
function parseGuidance(value: unknown): AiImageGuidance {
  const item = record(value, 'guidance')
  exact(item, GUIDANCE_KEYS, 'guidance')
  if (typeof item.poll !== 'boolean' || !['pending', 'processing', 'retrying', 'dlq', 'completed', 'failed', 'contact_support', 'result_expired'].includes(String(item.code)))
    invalid('guidance is unsupported')
  return item as unknown as AiImageGuidance
}

export function parseAiImageJobStatus(body: string, expectedClientId: string, expectedJobId: string): AiImageJob {
  const payload = parseObject(body, 'Job response')
  exact(payload, JOB_KEYS, 'Job response')
  const clientId = guid(payload.clientId, 'clientId')
  const jobId = uuid7(payload.jobId, 'jobId')
  if (clientId !== canonicalizeGuid(expectedClientId) || jobId !== expectedJobId)
    invalid('Job or Client does not match the requested scope')
  if (payload.requestType !== 'image_generation' || !AI_IMAGE_TARGET_ROLES.includes(payload.targetRole as never) || !AI_IMAGE_JOB_STATUSES.includes(payload.status as never))
    invalid('Job type, target role, or status is unsupported')
  const status = payload.status as AiImageJobStatus
  const quoteValue = record(payload.quote, 'quote')
  exact(quoteValue, QUOTE_KEYS, 'quote')
  const quote = { credits: decimal(quoteValue.credits, 'quote.credits')!, ruleVersion: text(quoteValue.ruleVersion, 'quote.ruleVersion', 256) }
  const reservation = parseReservation(payload.reservation)
  const result = parseResult(payload.result)
  const resultAccess = parseAccess(payload.resultAccess)
  const guidance = parseGuidance(payload.guidance)
  const attemptCount = integer(payload.attemptCount, 'attemptCount', 6)
  const createdAt = instant(payload.createdAt, 'createdAt')!
  const updatedAt = instant(payload.updatedAt, 'updatedAt')!
  const processingStartedAt = instant(payload.processingStartedAt, 'processingStartedAt', true)
  const lastAttemptCompletedAt = instant(payload.lastAttemptCompletedAt, 'lastAttemptCompletedAt', true)
  const completedAt = instant(payload.completedAt, 'completedAt', true)
  if (!sameDecimal(quote.credits, reservation.estimatedCredits) || reservation.reservationId.length === 0 ||
      at(updatedAt) < at(createdAt) || at(reservation.createdAt) < at(createdAt) ||
      at(reservation.expiresAt) <= at(reservation.createdAt) ||
      !notBefore(processingStartedAt, createdAt) || !notBefore(lastAttemptCompletedAt, processingStartedAt) ||
      !notBefore(completedAt, lastAttemptCompletedAt) || !notBefore(updatedAt, processingStartedAt) ||
      !notBefore(updatedAt, lastAttemptCompletedAt) || !notBefore(updatedAt, completedAt) ||
      !notBefore(reservation.committedAt, reservation.createdAt) ||
      !notBefore(reservation.releasedAt, reservation.createdAt))
    invalid('quote, reservation, or timestamp evidence is inconsistent')
  const guidanceMatches = guidance.code === status ||
    (status === 'execution_unknown' && guidance.code === 'contact_support') ||
    (status === 'completed' && guidance.code === 'result_expired')
  if (!guidanceMatches || guidance.poll !== ['pending', 'processing', 'retrying', 'dlq'].includes(status))
    invalid('status and guidance disagree')
  const noAttempt = attemptCount === 0 && !processingStartedAt && !lastAttemptCompletedAt
  const completedAttempt = attemptCount > 0 && Boolean(processingStartedAt) && Boolean(lastAttemptCompletedAt)
  const releasedAt = reservation.releasedAt
  const releaseMatchesTerminal = releasedAt !== null && releasedAt === completedAt
  const releaseMatchesReservationState = releasedAt !== null && releaseMatchesTerminal && (
    (reservation.state === 'released' && at(reservation.expiresAt) > at(releasedAt)) ||
    (reservation.state === 'expired' && at(reservation.expiresAt) <= at(releasedAt))
  )
  const terminalFailedReservation =
    ['released', 'expired'].includes(reservation.state) &&
    reservation.actualCredits === null &&
    reservation.committedAt === null &&
    releaseMatchesReservationState
  const validFailedState = Boolean(completedAt) && updatedAt === completedAt &&
    terminalFailedReservation && !result && !resultAccess && (
    (reservation.state === 'released' && completedAttempt) ||
    (reservation.state === 'expired' && (noAttempt || completedAttempt))
  )
  const canonicalUnknownCompletion =
    (lastAttemptCompletedAt === null && completedAt === null) ||
    (lastAttemptCompletedAt !== null && completedAt === lastAttemptCompletedAt)
  const validState = status === 'pending'
    ? attemptCount === 0 && !processingStartedAt && !lastAttemptCompletedAt && !completedAt && reservation.state === 'active' && reservation.actualCredits === null && !result && !resultAccess
    : status === 'processing'
      ? attemptCount > 0 && Boolean(processingStartedAt) && !lastAttemptCompletedAt && !completedAt && reservation.state === 'active' && reservation.actualCredits === null && !result && !resultAccess
      : status === 'retrying' || status === 'dlq'
        ? attemptCount > 0 && Boolean(processingStartedAt) && Boolean(lastAttemptCompletedAt) && !completedAt && reservation.state === 'active' && reservation.actualCredits === null && !result && !resultAccess
        : status === 'completed'
          ? attemptCount > 0 && Boolean(processingStartedAt) && Boolean(lastAttemptCompletedAt) && Boolean(completedAt) && reservation.state === 'committed' && reservation.actualCredits !== null && Boolean(reservation.committedAt) && !reservation.releasedAt && Boolean(result) && ((guidance.code === 'completed') === Boolean(resultAccess))
          : status === 'failed'
            ? validFailedState
            : attemptCount > 0 && Boolean(processingStartedAt) && canonicalUnknownCompletion && reservation.state === 'active' && reservation.actualCredits === null && !result && !resultAccess
  if (!validState) invalid('Job state evidence is impossible')
  if (result && (!completedAt || result.createdAt !== completedAt || at(result.observedAt) > at(result.createdAt) ||
      at(result.expiresAt) <= at(result.createdAt) || at(updatedAt) < at(result.createdAt)))
    invalid('result timestamp evidence is inconsistent')
  if (status === 'completed' && reservation.committedAt !== completedAt)
    invalid('completed reservation evidence is inconsistent')
  if (result && resultAccess && at(resultAccess.expiresAt) > at(result.expiresAt))
    invalid('result access outlives the private result')
  return {
    jobId, clientId, requestType: 'image_generation', targetRole: payload.targetRole as AiImageJob['targetRole'], status,
    attemptCount, createdAt, updatedAt, processingStartedAt, lastAttemptCompletedAt, completedAt,
    quote, reservation, result, resultAccess, guidance,
  }
}

export async function postAiImageAdmission(serializedBody: string, signal?: AbortSignal, onAuthReplay?: () => void): Promise<AiImageAdmissionReceipt> {
  const actorId = actor()
  const response = await apiClient.postApiRoot<string>('/api/ai/image-jobs', serializedBody, {
    responseType: 'text', signal, retryOnUnauthorized: false, headers: { 'Content-Type': 'application/json' },
    ...(onAuthReplay ? { onAuthReplay } : {}),
  })
  requireActor(actorId)
  if (typeof response.data !== 'string') return invalid('admission response must be JSON text')
  return parseAiImageAdmission(response.data, response.status)
}

export async function postAiImageAdmissionQuote(targetRole: AiImageTargetRole, signal?: AbortSignal): Promise<AiImageAdmissionQuote> {
  const actorId = actor()
  const body = serializeAiImageQuoteRequest(targetRole)
  const response = await apiClient.postApiRoot<string>('/api/ai/image-admission-quotes', body, {
    responseType: 'text', signal, retryOnUnauthorized: false, headers: { 'Content-Type': 'application/json' },
  })
  requireActor(actorId)
  if (response.status !== 200 || typeof response.data !== 'string') return invalid('quote response must be JSON HTTP 200 text')
  return parseAiImageAdmissionQuote(response.data, targetRole)
}

export async function getAiImageJob(clientId: string, jobId: string, signal?: AbortSignal, onAuthReplay?: () => void): Promise<AiImageJob> {
  const actorId = actor()
  const response = await apiClient.getApiRoot<string>(`/api/ai/jobs/${jobId}`, {
    responseType: 'text', signal, retryOnUnauthorized: false, ...(onAuthReplay ? { onAuthReplay } : {}),
  })
  requireActor(actorId)
  if (response.status !== 200 || typeof response.data !== 'string') return invalid('status response must be a JSON HTTP 200')
  return parseAiImageJobStatus(response.data, clientId, jobId)
}

export async function redeemAiImageResult(jobId: string, reference: string, expectedBytes: number, signal?: AbortSignal, onAuthReplay?: () => void): Promise<Blob> {
  const actorId = actor()
  if (!UUID_V7.test(jobId) || typeof reference !== 'string' || reference.length < 1 || reference.length > 4096)
    return invalid('redemption input is invalid')
  const response = await apiClient.postApiRoot<Blob>(`/api/ai/jobs/${jobId}/result-redemptions`, { reference }, {
    responseType: 'blob', signal, retryOnUnauthorized: false, headers: { 'Content-Type': 'application/json' },
    ...(onAuthReplay ? { onAuthReplay } : {}),
  })
  requireActor(actorId)
  const blob = response.data
  if (response.status !== 200 || !(blob instanceof Blob) || blob.type.toLowerCase() !== 'image/webp' || blob.size < 1 || blob.size !== expectedBytes)
    return invalid('private result bytes do not match verified metadata')
  return blob
}

const SAFE_MESSAGES: Record<AiImageProblem['kind'], string> = {
  authentication_required: 'Your session ended. Private image state was cleared.',
  forbidden: 'You no longer have permission for this image Job.',
  not_found: 'This image Job is unavailable in the current Client.',
  result_expired: 'The private result is no longer available. Check the Job status for current guidance.',
  validation: 'Review the image prompt and target role, then confirm a new command.',
  insufficient_credits: 'The selected Client does not have enough available abstract credits.',
  idempotency_conflict: 'The retained command identity conflicts with different input. Review and confirm a new command.',
  quote_expired: 'The reviewed quote expired. Review the input again to request a new quote.',
  quote_stale: 'The reviewed quote is stale. Review the input again to request a new quote.',
  quote_not_available: 'The reviewed quote is unavailable. Review the input again to request a new quote.',
  rate_limited: 'The service is temporarily limiting requests. Wait before trying the same safe action again.',
  admission_unknown: 'Admission is unconfirmed and financial or Job state may have changed. Retry only this exact retained command.',
  dependency_unavailable: 'A required service is temporarily unavailable. The Job may still continue.',
  configuration_unavailable: 'Image generation configuration or funding is unavailable for this Client.',
  transition_pending: 'A Client policy transition is still pending. Try again after it completes.',
  network: 'The request outcome could not be confirmed. The Job may still continue.',
  unknown: 'The request could not be completed safely.',
}

export function mapAiImageProblem(error: unknown, context: 'quote' | 'admission' | 'status' | 'redemption'): AiImageProblem {
  const value = error && typeof error === 'object' && 'code' in error ? error as ApiError : { code: 'UNKNOWN_ERROR', message: '' }
  const code = value.code
  const status = value.status
  let kind: AiImageProblem['kind'] = 'unknown'
  if (status === 401 || code === 'authentication_required') kind = 'authentication_required'
  else if (status === 403 || code === 'forbidden') kind = 'forbidden'
  else if (code === 'quote_expired') kind = 'quote_expired'
  else if (code === 'quote_stale') kind = 'quote_stale'
  else if (code === 'quote_not_available') kind = 'quote_not_available'
  else if (status === 404) kind = context === 'redemption' || code === 'result_not_available' ? 'result_expired' : 'not_found'
  else if (status === 402 || code === 'insufficient_credits') kind = 'insufficient_credits'
  else if (status === 409 || code === 'idempotency_conflict') kind = 'idempotency_conflict'
  else if ([400, 413, 422].includes(status ?? 0)) kind = 'validation'
  else if (status === 429 || code === 'back_pressure' || code === 'limit_reached' || code === 'rate_limit_exceeded') kind = 'rate_limited'
  else if (code === 'admission_outcome_unknown' || (!status && code === 'NETWORK_ERROR' && context === 'admission')) kind = 'admission_unknown'
  else if (code === 'configuration_unavailable') kind = 'configuration_unavailable'
  else if (code === 'transition_pending') kind = 'transition_pending'
  else if (status === 503 || code === 'dependency_unavailable') kind = context === 'quote' ? 'quote_not_available' : 'dependency_unavailable'
  else if (!status && code === 'NETWORK_ERROR') kind = 'network'
  return { kind, message: SAFE_MESSAGES[kind], retryAfterSeconds: kind === 'rate_limited' ? Math.min(60, Math.max(0, value.retryAfterSeconds ?? 0)) : null }
}
