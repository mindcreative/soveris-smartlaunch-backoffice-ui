import { isLosslessNumber, parse } from 'lossless-json'
import { apiClient } from './apiClient'
import { canonicalizeGuid } from '../lib/guid'
import { useAuthStore } from '../stores/authStore'
import {
  AI_CONTENT_OPERATIONS,
  AI_CONTENT_TYPES,
  type AiAcceptedAdmission,
  type AiCompletedAdmission,
  type AiContentAdmission,
  type AiContentGenerationRequest,
  type AiJobAttempt,
  type AiJobGuidance,
  type AiJobProviderCost,
  type AiJobReservation,
  type AiJobResult,
  type AiJobStatus,
  type AiJobStatusDto,
  type AiJobUsage,
} from '../types/aiContent'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DECIMAL = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/
const REQUEST_KEYS = [
  'idempotencyKey', 'operation', 'contentType', 'productSlug', 'productName',
  'existingContent', 'targetAudience', 'tone', 'variations', 'instructions', 'content',
] as const
const COMPLETE_KEYS = [
  'attemptId', 'committedCredits', 'correlationId', 'jobId', 'modelName',
  'providerName', 'replay', 'reservationId', 'status', 'usage', 'variations',
] as const
const ACCEPTED_KEYS = [
  'attemptId', 'correlationId', 'jobId', 'quotedCredits', 'replay',
  'reservationId', 'status',
] as const
const JOB_KEYS = [
  'attempt', 'clientId', 'completedAt', 'correlationId', 'createdAt', 'guidance',
  'jobId', 'processingStartedAt', 'providerCost', 'requestType', 'reservation',
  'result', 'status', 'submittedByUserId', 'updatedAt', 'usage',
] as const
const ATTEMPT_KEYS = ['attemptId', 'attemptNumber', 'completedAt', 'executionPhase', 'failureCategory', 'outcomeStatus', 'providerName', 'retryDisposition', 'startedAt'] as const
const RESERVATION_KEYS = ['actualCredits', 'committedAt', 'createdAt', 'estimatedCredits', 'expiresAt', 'releasedAt', 'reservationId', 'state'] as const
const RESULT_KEYS = ['createdAt', 'modelName', 'observedAt', 'providerName', 'resultId', 'variations'] as const
const USAGE_KEYS = ['attemptId', 'costInCredits', 'createdAt', 'imagesGenerated', 'inputTokens', 'observedAt', 'outputTokens', 'usageId'] as const
const COST_KEYS = ['actualCostSource', 'actualPrice', 'attemptId', 'capturedAt', 'costId', 'costStatus', 'currencyCode', 'estimatedCostSource', 'estimatedPrice', 'reconciledAt'] as const
const GUIDANCE_KEYS = ['action', 'code', 'poll'] as const

export class AiContentContractError extends Error {
  constructor(reason: string) {
    super(`Invalid AI content contract: ${reason}`)
    this.name = 'AiContentContractError'
  }
}

function invalid(reason: string): never { throw new AiContentContractError(reason) }
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isLosslessNumber(value)) invalid(`${field} must be an object`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(`${field} fields do not match the closed contract`)
}
function uuid7(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V7.test(value)) invalid(`${field} must be a canonical UUIDv7`)
  return value
}
function guid(value: unknown, field: string): string {
  const result = canonicalizeGuid(typeof value === 'string' ? value : undefined)
  if (!result || result !== value) invalid(`${field} must be a canonical GUID`)
  return result
}
function text(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be nonblank text`)
  return value
}
function instant(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  const absolute = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  const localWall = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)
  if (!absolute && !localWall) invalid(`${field} must be an instant`)
  return value
}
function integer(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null
  const lexeme = isLosslessNumber(value) ? value.toString() : typeof value === 'number' ? String(value) : ''
  if (!/^\d+$/.test(lexeme)) invalid(`${field} must be an integer`)
  const number = Number(lexeme)
  if (!Number.isSafeInteger(number) || number > 2_147_483_647) invalid(`${field} is outside the Int32 contract`)
  return number
}
function decimal(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (!isLosslessNumber(value)) invalid(`${field} must be a JSON number`)
  const result = value.toString()
  if (!DECIMAL.test(result)) invalid(`${field} is outside the decimal contract`)
  return result
}
function parsePayload(value: string, field: string): Record<string, unknown> {
  try { return record(parse(value), field) }
  catch (error) { if (error instanceof AiContentContractError) throw error; return invalid(`${field} is not valid JSON`) }
}

export function serializeAiContentRequest(request: AiContentGenerationRequest): string {
  const value = record(request, 'request')
  exact(value, REQUEST_KEYS, 'request')
  uuid7(request.idempotencyKey, 'idempotencyKey')
  if (!AI_CONTENT_OPERATIONS.includes(request.operation) || !AI_CONTENT_TYPES.includes(request.contentType)) invalid('operation or contentType is unsupported')
  const allowedTone = ['professional', 'casual', 'persuasive', 'informative', 'friendly', 'technical', null]
  if (!allowedTone.includes(request.tone)) invalid('tone is unsupported')
  const bounded = (value: string | null, max: number, field: string) => {
    if (value !== null && (typeof value !== 'string' || value.length > max)) invalid(`${field} is outside its bound`)
  }
  bounded(request.productSlug, 256, 'productSlug')
  bounded(request.productName, 512, 'productName')
  bounded(request.existingContent, 10_000, 'existingContent')
  bounded(request.targetAudience, 2_000, 'targetAudience')
  bounded(request.instructions, 4_000, 'instructions')
  bounded(request.content, 10_000, 'content')
  if (!Number.isInteger(request.variations) || request.variations < 1 || request.variations > 10) invalid('variations is outside its bound')
  if (request.operation === 'rewrite_content' && (request.content === null || request.content.trim().length < 10)) invalid('rewrite content must contain at least 10 characters')
  return JSON.stringify({
    idempotencyKey: request.idempotencyKey, operation: request.operation,
    contentType: request.contentType, productSlug: request.productSlug,
    productName: request.productName, existingContent: request.existingContent,
    targetAudience: request.targetAudience, tone: request.tone,
    variations: request.variations, instructions: request.instructions,
    content: request.content,
  })
}

function admissionBase(payload: Record<string, unknown>) {
  return {
    jobId: uuid7(payload.jobId, 'jobId'), reservationId: uuid7(payload.reservationId, 'reservationId'),
    attemptId: uuid7(payload.attemptId, 'attemptId'), correlationId: uuid7(payload.correlationId, 'correlationId'),
    replay: typeof payload.replay === 'boolean' ? payload.replay : invalid('replay must be boolean'),
  }
}

export function parseAiContentAdmission(body: string, status: number): AiContentAdmission {
  const payload = parsePayload(body, 'admission response')
  if (status === 200) {
    exact(payload, COMPLETE_KEYS, 'completed response')
    if (payload.status !== 'completed' || !Array.isArray(payload.variations) || payload.variations.length < 1 || payload.variations.length > 10 || payload.variations.some((item) => typeof item !== 'string' || !item.trim())) invalid('completed result is invalid')
    const usage = record(payload.usage, 'usage')
    exact(usage, ['inputTokens', 'outputTokens'], 'usage')
    const result: AiCompletedAdmission = {
      kind: 'completed', ...admissionBase(payload), status: 'completed',
      variations: payload.variations as string[], providerName: text(payload.providerName, 'providerName')!,
      modelName: text(payload.modelName, 'modelName')!,
      usage: { inputTokens: integer(usage.inputTokens, 'inputTokens')!, outputTokens: integer(usage.outputTokens, 'outputTokens')! },
      committedCredits: decimal(payload.committedCredits, 'committedCredits')!,
    }
    return result
  }
  if (status === 202) {
    exact(payload, ACCEPTED_KEYS, 'accepted response')
    if (!['reserved', 'processing', 'failed', 'execution_unknown'].includes(String(payload.status))) invalid('accepted status is unsupported')
    return { kind: 'accepted', ...admissionBase(payload), status: payload.status, quotedCredits: decimal(payload.quotedCredits, 'quotedCredits')! } as AiAcceptedAdmission
  }
  return invalid('admission HTTP status is unsupported')
}

function parseAttempt(value: unknown): AiJobAttempt {
  const item = record(value, 'attempt'); exact(item, ATTEMPT_KEYS, 'attempt')
  if (!['processing', 'succeeded', 'failed', 'execution_unknown'].includes(String(item.outcomeStatus)) || !['pre_dispatch', 'dispatched', 'resolved'].includes(String(item.executionPhase)) || ![null, 'retryable', 'non_retryable', 'unknown'].includes(item.retryDisposition as never) || ![null, 'timeout', 'provider_error', 'validation_error', 'internal_error', 'cancelled'].includes(item.failureCategory as never)) invalid('attempt state is unsupported')
  return {
    attemptId: uuid7(item.attemptId, 'attemptId'), attemptNumber: integer(item.attemptNumber, 'attemptNumber')!,
    outcomeStatus: item.outcomeStatus as AiJobAttempt['outcomeStatus'], executionPhase: item.executionPhase as AiJobAttempt['executionPhase'],
    providerName: item.providerName === null ? null : text(item.providerName, 'providerName'),
    failureCategory: item.failureCategory as AiJobAttempt['failureCategory'],
    retryDisposition: item.retryDisposition as AiJobAttempt['retryDisposition'],
    startedAt: instant(item.startedAt, 'startedAt')!, completedAt: instant(item.completedAt, 'attempt.completedAt', true),
  }
}
function parseReservation(value: unknown): AiJobReservation {
  const item = record(value, 'reservation'); exact(item, RESERVATION_KEYS, 'reservation')
  if (!['active', 'committed', 'released', 'expired'].includes(String(item.state))) invalid('reservation state is unsupported')
  return {
    reservationId: uuid7(item.reservationId, 'reservationId'), state: item.state as AiJobReservation['state'],
    estimatedCredits: decimal(item.estimatedCredits, 'estimatedCredits')!, actualCredits: decimal(item.actualCredits, 'actualCredits', true),
    createdAt: instant(item.createdAt, 'reservation.createdAt')!, expiresAt: instant(item.expiresAt, 'expiresAt')!,
    committedAt: instant(item.committedAt, 'committedAt', true), releasedAt: instant(item.releasedAt, 'releasedAt', true),
  }
}
function parseResult(value: unknown): AiJobResult | null {
  if (value === null) return null
  const item = record(value, 'result'); exact(item, RESULT_KEYS, 'result')
  if (!Array.isArray(item.variations) || item.variations.length < 1 || item.variations.length > 10 || item.variations.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 262_144)) invalid('result variations are invalid')
  return { resultId: uuid7(item.resultId, 'resultId'), variations: item.variations as string[], providerName: text(item.providerName, 'result.providerName')!, modelName: text(item.modelName, 'modelName')!, observedAt: instant(item.observedAt, 'result.observedAt')!, createdAt: instant(item.createdAt, 'result.createdAt')! }
}
function parseUsage(value: unknown): AiJobUsage | null {
  if (value === null) return null
  const item = record(value, 'usage'); exact(item, USAGE_KEYS, 'usage')
  if (integer(item.imagesGenerated, 'imagesGenerated') !== 0) invalid('content usage cannot contain images')
  return { usageId: uuid7(item.usageId, 'usageId'), attemptId: uuid7(item.attemptId, 'usage.attemptId'), inputTokens: integer(item.inputTokens, 'inputTokens', true), outputTokens: integer(item.outputTokens, 'outputTokens', true), imagesGenerated: 0, costInCredits: decimal(item.costInCredits, 'costInCredits')!, observedAt: instant(item.observedAt, 'usage.observedAt')!, createdAt: instant(item.createdAt, 'usage.createdAt')! }
}
function parseCost(value: unknown): AiJobProviderCost | null {
  if (value === null) return null
  const item = record(value, 'providerCost'); exact(item, COST_KEYS, 'providerCost')
  if (!['unresolved', 'estimated', 'reconciled'].includes(String(item.costStatus)) || ![null, 'provider_response', 'calculated_from_provider_pricing'].includes(item.estimatedCostSource as never) || ![null, 'provider_response', 'provider_billing_api', 'manual_reconciliation'].includes(item.actualCostSource as never) || (item.currencyCode !== null && (typeof item.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(item.currencyCode)))) invalid('provider cost vocabulary is unsupported')
  const estimatedPrice = decimal(item.estimatedPrice, 'estimatedPrice', true)
  const actualPrice = decimal(item.actualPrice, 'actualPrice', true)
  const reconciledAt = instant(item.reconciledAt, 'reconciledAt', true)
  const validShape = item.costStatus === 'unresolved'
    ? estimatedPrice === null && item.estimatedCostSource === null && actualPrice === null && item.actualCostSource === null && item.currencyCode === null && reconciledAt === null
    : item.costStatus === 'estimated'
      ? estimatedPrice !== null && item.estimatedCostSource !== null && actualPrice === null && item.actualCostSource === null && item.currencyCode !== null && reconciledAt === null
      : actualPrice !== null && item.actualCostSource !== null && item.currencyCode !== null && reconciledAt !== null && ((estimatedPrice === null) === (item.estimatedCostSource === null))
  if (!validShape) invalid('provider cost evidence is inconsistent')
  return { costId: uuid7(item.costId, 'costId'), attemptId: uuid7(item.attemptId, 'cost.attemptId'), costStatus: item.costStatus as AiJobProviderCost['costStatus'], estimatedPrice, estimatedCostSource: item.estimatedCostSource as string | null, actualPrice, actualCostSource: item.actualCostSource as string | null, currencyCode: item.currencyCode as string | null, capturedAt: instant(item.capturedAt, 'capturedAt')!, reconciledAt }
}
function parseGuidance(value: unknown): AiJobGuidance {
  const item = record(value, 'guidance'); exact(item, GUIDANCE_KEYS, 'guidance')
  const encoded = `${item.code}:${String(item.poll)}:${item.action}`
  if (!['pending:true:wait', 'complete:false:view_result', 'failed:false:contact_support', 'outcome_unknown:false:contact_support', 'cancelled:false:contact_support'].includes(encoded)) invalid('guidance is unsupported')
  return item as unknown as AiJobGuidance
}

export function parseAiJobStatus(body: string, expectedClientId: string, expectedJobId: string): AiJobStatusDto {
  const payload = parsePayload(body, 'Job response'); exact(payload, JOB_KEYS, 'Job response')
  const clientId = guid(payload.clientId, 'clientId')
  const jobId = uuid7(payload.jobId, 'jobId')
  if (clientId !== canonicalizeGuid(expectedClientId) || jobId !== expectedJobId) invalid('Job or Client does not match the requested scope')
  if (payload.requestType !== 'content_generation' || !['reserved', 'pending', 'processing', 'completed', 'failed', 'execution_unknown', 'cancelled'].includes(String(payload.status))) invalid('Job type or status is unsupported')
  const status = payload.status as AiJobStatus
  const guidance = parseGuidance(payload.guidance)
  const expectedGuidance: Record<AiJobStatus, AiJobGuidance['code']> = { reserved: 'pending', pending: 'pending', processing: 'pending', completed: 'complete', failed: 'failed', execution_unknown: 'outcome_unknown', cancelled: 'cancelled' }
  if (guidance.code !== expectedGuidance[status]) invalid('Job status and guidance disagree')
  const result = parseResult(payload.result)
  if ((status === 'completed') !== Boolean(result)) invalid('Job result evidence disagrees with status')
  const attempt = parseAttempt(payload.attempt)
  const reservation = parseReservation(payload.reservation)
  const usage = parseUsage(payload.usage)
  const providerCost = parseCost(payload.providerCost)
  if ((usage && usage.attemptId !== attempt.attemptId) || (providerCost && providerCost.attemptId !== attempt.attemptId)) invalid('attempt evidence does not match')
  const nonterminal = ['reserved', 'pending', 'processing'].includes(status)
  const terminalTime = payload.completedAt !== null && attempt.completedAt !== null
  const stateValid = nonterminal
    ? attempt.outcomeStatus === 'processing' && reservation.state === 'active' && payload.completedAt === null && attempt.completedAt === null && result === null && usage === null && providerCost === null
    : status === 'completed'
      ? terminalTime && attempt.outcomeStatus === 'succeeded' && attempt.executionPhase === 'resolved' && reservation.state === 'committed' && reservation.actualCredits !== null && reservation.committedAt !== null && result !== null && usage !== null && providerCost !== null
      : status === 'failed'
        ? terminalTime && attempt.outcomeStatus === 'failed' && attempt.executionPhase === 'pre_dispatch' && attempt.failureCategory !== null && attempt.retryDisposition === 'non_retryable' && reservation.state === 'released' && reservation.releasedAt !== null && result === null && usage === null && providerCost === null
        : status === 'execution_unknown'
          ? terminalTime && attempt.outcomeStatus === 'execution_unknown' && ['dispatched', 'resolved'].includes(attempt.executionPhase) && attempt.failureCategory !== null && attempt.retryDisposition === 'unknown' && reservation.state === 'active' && result === null && usage === null && providerCost === null
          : terminalTime && attempt.outcomeStatus === 'failed' && attempt.failureCategory === 'cancelled' && ['released', 'expired'].includes(reservation.state) && reservation.releasedAt !== null && result === null && usage === null && providerCost === null
  if (!stateValid) invalid('Job state evidence is impossible')
  return {
    jobId, clientId, requestType: 'content_generation', status,
    correlationId: uuid7(payload.correlationId, 'correlationId'),
    submittedByUserId: payload.submittedByUserId === null ? null : guid(payload.submittedByUserId, 'submittedByUserId'),
    createdAt: instant(payload.createdAt, 'createdAt')!, updatedAt: instant(payload.updatedAt, 'updatedAt')!,
    processingStartedAt: instant(payload.processingStartedAt, 'processingStartedAt', true), completedAt: instant(payload.completedAt, 'completedAt', true),
    result, attempt, reservation, usage, providerCost, guidance,
  }
}

function actor(): string {
  const id = useAuthStore.getState().user?.id
  if (!id) return invalid('authenticated actor is unavailable')
  return id
}
function requireActor(expected: string): void {
  if (useAuthStore.getState().user?.id !== expected) invalid('authenticated actor changed during response load')
}

export async function postAiContentGeneration(serializedBody: string, signal?: AbortSignal, onAuthReplay?: () => void): Promise<AiContentAdmission> {
  const actorId = actor()
  const response = await apiClient.postApiRoot<string>('/api/ai/content-generations', serializedBody, {
    responseType: 'text', signal, ...(onAuthReplay ? { onAuthReplay } : {}), headers: { 'Content-Type': 'application/json' },
  })
  requireActor(actorId)
  if (typeof response.data !== 'string') return invalid('admission response must be JSON text')
  return parseAiContentAdmission(response.data, response.status)
}

export async function getAiContentJob(clientId: string, jobId: string, signal?: AbortSignal): Promise<AiJobStatusDto> {
  const actorId = actor()
  uuid7(jobId, 'jobId')
  const response = await apiClient.getApiRoot<string>(`/api/ai/jobs/${jobId}`, { responseType: 'text', signal })
  requireActor(actorId)
  if (response.status !== 200 || typeof response.data !== 'string') return invalid('Job response must be JSON text')
  return parseAiJobStatus(response.data, clientId, jobId)
}
