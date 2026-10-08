import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import { AiContentContractError, getAiContentJob, postAiContentGeneration, serializeAiContentRequest } from '../api/aiContentApi'
import { AiBackendPreparationError } from '../api/aiBackendPreparation'
import { createUuidV7 } from '../lib/uuidV7'
import type {
  AiContentGenerationRequest,
  AiGenerationMaterial,
  AiJobStatusDto,
  AiRetainedAttempt,
} from '../types/aiContent'
import type { ClientClassification } from '../types/billing'
import { clearPrivateClientScope } from './billingQueries'
import { aiContentKeys } from './aiContentKeys'

export type AiGenerationPhase =
  | 'idle' | 'submitting' | 'polling' | 'completed' | 'failed'
  | 'cancelled' | 'execution_unknown' | 'admission_unknown' | 'delayed'
  | 'validation' | 'insufficient_credits' | 'rate_limited'
  | 'permission_lost' | 'unavailable' | 'contract_invalid'

export interface AiGenerationState {
  phase: AiGenerationPhase
  attempt: AiRetainedAttempt | null
  job: AiJobStatusDto | null
  jobId: string | null
  lastCheckedAt: number | null
  message: string
  retryAfterUntil: number | null
  prior: AiCompletedGeneration | null
}

export interface AiCompletedGeneration {
  attempt: AiRetainedAttempt
  job: AiJobStatusDto
  jobId: string
  lastCheckedAt: number
}

export interface AiWorkflowDependencies {
  now: () => number
  uuid: () => string
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  post: typeof postAiContentGeneration
  get: typeof getAiContentJob
}

const initialState: AiGenerationState = {
  phase: 'idle', attempt: null, job: null, jobId: null,
  lastCheckedAt: null, message: '', retryAfterUntil: null, prior: null,
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

const defaults: AiWorkflowDependencies = {
  now: Date.now, uuid: createUuidV7, sleep: defaultSleep,
  post: postAiContentGeneration, get: getAiContentJob,
}

export function buildAiContentRequest(material: AiGenerationMaterial, idempotencyKey: string): AiContentGenerationRequest {
  const mappings = {
    hero: ['generate_content', 'hero'], features: ['generate_content', 'features'],
    faq: ['generate_content', 'faq'], cta: ['generate_content', 'cta'],
    description: ['generate_content', 'description'], headline: ['generate_headline', 'headline'],
    meta_title: ['generate_seo', 'meta_title'], meta_description: ['generate_seo', 'meta_description'],
    rewrite: ['rewrite_content', 'description'], image_prompt: ['generate_image_prompt', 'image_prompt'],
  } as const
  const [operation, contentType] = mappings[material.target]
  return {
    idempotencyKey, operation, contentType,
    productSlug: material.productSlug || null, productName: material.productName || null,
    existingContent: material.currentValue || null, targetAudience: material.targetAudience || null,
    tone: material.tone, variations: material.variations,
    instructions: material.instructions || null,
    content: operation === 'rewrite_content' ? material.currentValue : null,
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function apiError(error: unknown): ApiError {
  return error && typeof error === 'object' && 'code' in error
    ? error as ApiError : { code: 'UNKNOWN_ERROR', message: 'The request could not be completed.' }
}

export interface UseAiContentGenerationOptions {
  actorId: string
  clientId: string
  productId: string
  classification: ClientClassification
  authorized: boolean
  dependencies?: Partial<AiWorkflowDependencies>
}

export function useAiContentGeneration({
  actorId, clientId, productId, classification, authorized, dependencies,
}: UseAiContentGenerationOptions) {
  const queryClient = useQueryClient()
  const depsRef = useRef<AiWorkflowDependencies>({ ...defaults, ...dependencies })
  depsRef.current = { ...defaults, ...dependencies }
  const [state, setState] = useState<AiGenerationState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const ownAuthReplayRef = useRef(false)
  const scope = `${actorId}:${clientId}:${productId}`
  const priorScope = useRef(scope)

  const current = useCallback((generation: number) => generationRef.current === generation, [])
  const replace = useCallback((next: AiGenerationState | ((value: AiGenerationState) => AiGenerationState)) => {
    setState((value) => {
      const resolved = typeof next === 'function' ? next(value) : next
      stateRef.current = resolved
      return resolved
    })
  }, [])

  const purge = useCallback((phase: AiGenerationPhase = 'idle', message = '') => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    replace({ ...initialState, phase, message })
    void clearPrivateClientScope(queryClient, clientId)
  }, [clientId, queryClient, replace])

  const purgeAiOnly = useCallback((phase: AiGenerationPhase, message: string) => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    replace({ ...initialState, phase, message })
    const queryKey = aiContentKeys.product(clientId, actorId, productId)
    void queryClient.cancelQueries({ queryKey }).then(() => queryClient.removeQueries({ queryKey }))
  }, [actorId, clientId, productId, queryClient, replace])

  useEffect(() => {
    if (priorScope.current !== scope) {
      priorScope.current = scope
      purge('unavailable', 'The Client or product changed. The prior generated content was cleared.')
    }
  }, [purge, scope])

  useEffect(() => {
    if (!authorized && stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'permission_lost')
      purgeAiOnly('permission_lost', 'AI permission changed. Generated private content was cleared.')
  }, [authorized, purgeAiOnly])

  useEffect(() => {
    const clearForBoundary = (event: Event) => {
      if (event.type === 'auth:refreshed' && ownAuthReplayRef.current) {
        ownAuthReplayRef.current = false
        return
      }
      purge('unavailable', 'The session or navigation context changed. Generated private content was cleared.')
    }
    window.addEventListener('auth:cleared', clearForBoundary)
    window.addEventListener('auth:refreshed', clearForBoundary)
    window.addEventListener('popstate', clearForBoundary)
    return () => {
      window.removeEventListener('auth:cleared', clearForBoundary)
      window.removeEventListener('auth:refreshed', clearForBoundary)
      window.removeEventListener('popstate', clearForBoundary)
    }
  }, [purge])

  useEffect(() => () => {
    generationRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    queryClient.removeQueries({ queryKey: aiContentKeys.product(clientId, actorId, productId) })
  }, [actorId, clientId, productId, queryClient])

  const terminalFromJob = useCallback((job: AiJobStatusDto, attempt: AiRetainedAttempt, checkedAt: number): AiGenerationState => {
    const base = { attempt, job, jobId: job.jobId, lastCheckedAt: checkedAt, retryAfterUntil: null, prior: stateRef.current.prior }
    if (job.status === 'completed') return { ...base, phase: 'completed', message: 'Saved generated content is ready for preview.' }
    if (job.status === 'failed') return { ...base, phase: 'failed', message: 'Generation did not run successfully. Contact support with the Job ID.' }
    if (job.status === 'execution_unknown') return { ...base, phase: 'execution_unknown', message: 'Execution outcome is unknown. Credits remain reserved and a blind retry is unsafe.' }
    if (job.status === 'cancelled') return { ...base, phase: 'cancelled', message: 'Generation was cancelled. Contact support with the Job ID.' }
    return { ...base, phase: 'polling', message: 'Generating. Checking the saved result…' }
  }, [])

  const handleGetError = useCallback((error: unknown, attempt: AiRetainedAttempt, jobId: string): AiGenerationState => {
    const now = depsRef.current.now()
    if (error instanceof AiContentContractError) return { phase: 'contract_invalid', attempt, job: null, jobId, lastCheckedAt: now, retryAfterUntil: null, prior: stateRef.current.prior, message: 'The saved result could not be verified safely. Contact support with the Job ID.' }
    const failure = apiError(error)
    if (failure.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:cleared'))
      return { ...initialState, phase: 'permission_lost', message: 'Your session ended. Generated private content was cleared.' }
    }
    if (failure.status === 403) return { ...initialState, phase: 'permission_lost', message: 'AI permission changed. Generated private content was cleared.' }
    if (failure.status === 404) return { ...initialState, phase: 'unavailable', message: 'The result is unavailable in the current Client.' }
    const retryAfterUntil = failure.status === 429 && failure.retryAfterSeconds !== undefined ? now + failure.retryAfterSeconds * 1000 : null
    return { phase: failure.status === 429 ? 'rate_limited' : 'delayed', attempt, job: null, jobId, lastCheckedAt: now, retryAfterUntil, prior: stateRef.current.prior, message: failure.status === 429 ? 'Status checks are rate limited. Wait before checking again.' : 'Status not confirmed. The Job may still be running; use Check status.' }
  }, [])

  const resolveJob = useCallback(async (attempt: AiRetainedAttempt, jobId: string, generation: number, automatic: boolean) => {
    const controller = abortRef.current
    if (!controller) return
    let delayIndex = 0
    const delays = [1_000, 2_000, 4_000, 8_000, 10_000]
    while (current(generation) && !controller.signal.aborted) {
      const now = depsRef.current.now()
      const elapsed = now - attempt.startedAt
      if (automatic) {
        const delay = delays[Math.min(delayIndex, delays.length - 1)]!
        if (elapsed + delay > 60_000) {
          busyRef.current = false
          replace((value) => ({ ...value, phase: 'delayed', message: 'Status not confirmed within the 60-second page budget. The Job may still be running; use Check status.' }))
          return
        }
        try { await depsRef.current.sleep(delay, controller.signal) }
        catch (error) { if (!isAbort(error)) throw error; return }
        delayIndex += 1
      }
      try {
        const job = await depsRef.current.get(attempt.clientId, jobId, controller.signal)
        if (!current(generation)) return
        const checkedAt = depsRef.current.now()
        queryClient.setQueryData(aiContentKeys.job(attempt.clientId, attempt.actorId, attempt.productId, jobId), job)
        const next = terminalFromJob(job, attempt, checkedAt)
        replace(next)
        if (!job.guidance.poll) { busyRef.current = false; return }
        if (!automatic) { busyRef.current = false; return }
      } catch (error) {
        if (!current(generation) || isAbort(error)) return
        const next = handleGetError(error, attempt, jobId)
        if (next.phase === 'permission_lost' || next.phase === 'unavailable') {
          queryClient.removeQueries({ queryKey: aiContentKeys.product(attempt.clientId, attempt.actorId, attempt.productId) })
        }
        replace(next)
        busyRef.current = false
        return
      }
    }
  }, [current, handleGetError, queryClient, replace, terminalFromJob])

  const submitRetained = useCallback(async (attempt: AiRetainedAttempt, generation: number, prepareBackend = false) => {
    const controller = abortRef.current
    if (!controller || !current(generation)) return
    replace((value) => ({ phase: 'submitting', attempt, job: null, jobId: null, lastCheckedAt: null, message: 'Submitting one retained generation attempt…', retryAfterUntil: null, prior: value.prior }))
    try {
      const admitted = await depsRef.current.post(attempt.serializedBody, controller.signal, () => { ownAuthReplayRef.current = true }, prepareBackend)
      if (!current(generation)) return
      replace((value) => ({ ...value, phase: 'polling', jobId: admitted.jobId, message: admitted.kind === 'completed' ? 'Generation completed; verifying the saved result…' : 'Generation admitted; checking the saved result…' }))
      await resolveJob(attempt, admitted.jobId, generation, true)
    } catch (error) {
      if (!current(generation) || isAbort(error)) return
      const failure = apiError(error)
      const common = { attempt, job: null, jobId: null, lastCheckedAt: null, prior: stateRef.current.prior }
      if (error instanceof AiBackendPreparationError) {
        busyRef.current = false
        replace({ ...common, phase: 'validation', retryAfterUntil: null, message: error.message })
        return
      }
      if (failure.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:cleared'))
        replace({ ...initialState, phase: 'permission_lost', message: 'Your session ended. Generated private content was cleared.' })
      } else if (failure.status === 403) {
        replace({ ...initialState, phase: 'permission_lost', message: 'AI permission changed. Generated private content was cleared.' })
      } else if (failure.status === 402 || failure.code === 'insufficient_credits') {
        replace({ ...common, phase: 'insufficient_credits', retryAfterUntil: null, message: classification === 'soveris_internal' ? 'AI funding is not configured or available for this internal Client; contact a Billing administrator.' : 'AI credits are insufficient. Add funding or contact a Billing administrator.' })
      } else if ([400, 413, 422].includes(failure.status ?? 0)) {
        replace({ ...common, phase: 'validation', retryAfterUntil: null, message: failure.message || 'Correct the generation inputs and try a new action.' })
      } else if (failure.status === 409 || failure.code === 'idempotency_conflict') {
        replace({ ...common, phase: 'contract_invalid', retryAfterUntil: null, message: 'The retained idempotency identity conflicts with a different request. Automatic retry is disabled.' })
      } else if (failure.status === 429 || failure.code === 'limit_reached') {
        const now = depsRef.current.now()
        replace({ ...common, phase: 'rate_limited', retryAfterUntil: failure.retryAfterSeconds === undefined ? null : now + failure.retryAfterSeconds * 1000, message: 'Admission is rate limited. Wait, then recover this same attempt.' })
      } else {
        replace({ ...common, phase: 'admission_unknown', retryAfterUntil: null, message: 'Admission outcome is unconfirmed. Recover this exact attempt; do not start another.' })
      }
      busyRef.current = false
    }
  }, [classification, current, replace, resolveJob])

  const generate = useCallback((material: AiGenerationMaterial): boolean => {
    if (!authorized || busyRef.current || (stateRef.current.jobId !== null)) return false
    const previous = stateRef.current.phase
    if (stateRef.current.attempt && ['admission_unknown', 'rate_limited'].includes(previous)) return false
    if (['completed', 'failed', 'cancelled', 'execution_unknown', 'contract_invalid', 'permission_lost', 'unavailable'].includes(previous)) return false
    busyRef.current = true
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const generation = generationRef.current
    try {
      const idempotencyKey = depsRef.current.uuid()
      const request = buildAiContentRequest(material, idempotencyKey)
      const attempt: AiRetainedAttempt = { actorId, clientId, productId, idempotencyKey, request, serializedBody: serializeAiContentRequest(request), material: structuredClone(material), startedAt: depsRef.current.now() }
      void submitRetained(attempt, generation, true)
      return true
    } catch (error) {
      busyRef.current = false
      replace({ ...initialState, phase: 'validation', message: error instanceof Error ? error.message : 'Generation inputs are invalid.' })
      return false
    }
  }, [actorId, authorized, clientId, productId, replace, submitRetained])

  const regenerate = useCallback((material: AiGenerationMaterial): boolean => {
    const value = stateRef.current
    if (!authorized || busyRef.current || value.phase !== 'completed' || !value.attempt ||
      !value.job || !value.jobId || value.job.status !== 'completed' || !value.job.result ||
      value.job.guidance.code !== 'complete' || value.job.guidance.poll ||
      value.job.guidance.action !== 'view_result' || value.lastCheckedAt === null) return false
    busyRef.current = true
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const generation = generationRef.current
    try {
      const idempotencyKey = depsRef.current.uuid()
      const request = buildAiContentRequest(material, idempotencyKey)
      const attempt: AiRetainedAttempt = { actorId, clientId, productId, idempotencyKey, request, serializedBody: serializeAiContentRequest(request), material: structuredClone(material), startedAt: depsRef.current.now() }
      replace({ ...value, prior: { attempt: value.attempt, job: value.job, jobId: value.jobId, lastCheckedAt: value.lastCheckedAt } })
      void submitRetained(attempt, generation)
      return true
    } catch (error) {
      busyRef.current = false
      replace({ ...value, phase: 'validation', message: error instanceof Error ? error.message : 'Generation inputs are invalid.' })
      return false
    }
  }, [actorId, authorized, clientId, productId, replace, submitRetained])

  const recover = useCallback((): boolean => {
    const value = stateRef.current
    if (busyRef.current || value.jobId || !value.attempt || !['admission_unknown', 'rate_limited'].includes(value.phase) || (value.retryAfterUntil !== null && depsRef.current.now() < value.retryAfterUntil)) return false
    busyRef.current = true
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    void submitRetained(value.attempt, generationRef.current)
    return true
  }, [submitRetained])

  const checkStatus = useCallback((): boolean => {
    const value = stateRef.current
    if (busyRef.current || !value.jobId || !value.attempt || (value.retryAfterUntil !== null && depsRef.current.now() < value.retryAfterUntil)) return false
    busyRef.current = true
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    replace((currentValue) => ({ ...currentValue, phase: 'polling', message: 'Checking the saved result…' }))
    void resolveJob(value.attempt, value.jobId, generationRef.current, false)
    return true
  }, [replace, resolveJob])

  const recheckCompleted = useCallback(async (): Promise<AiJobStatusDto | null> => {
    const value = stateRef.current
    if (busyRef.current || value.phase !== 'completed' || !value.jobId || !value.attempt ||
      !value.job?.result || value.job.status !== 'completed') return null
    busyRef.current = true
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const generation = generationRef.current
    try {
      const job = await depsRef.current.get(value.attempt.clientId, value.jobId, abortRef.current.signal)
      if (!current(generation)) return null
      const checkedAt = depsRef.current.now()
      queryClient.setQueryData(aiContentKeys.job(value.attempt.clientId, value.attempt.actorId, value.attempt.productId, value.jobId), job)
      const next = terminalFromJob(job, value.attempt, checkedAt)
      replace(next)
      return next.phase === 'completed' && job.result ? job : null
    } catch (error) {
      if (!current(generation) || isAbort(error)) return null
      const next = handleGetError(error, value.attempt, value.jobId)
      if (next.phase === 'permission_lost' || next.phase === 'unavailable') {
        queryClient.removeQueries({ queryKey: aiContentKeys.product(value.attempt.clientId, value.attempt.actorId, value.attempt.productId) })
      }
      replace(next)
      return null
    } finally {
      if (current(generation)) busyRef.current = false
    }
  }, [current, handleGetError, queryClient, replace, terminalFromJob])

  const dismiss = useCallback((): boolean => {
    const value = stateRef.current
    if (busyRef.current || (!value.job?.result && !value.prior?.job.result)) return false
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    replace(initialState)
    queryClient.removeQueries({ queryKey: aiContentKeys.product(clientId, actorId, productId) })
    return true
  }, [actorId, clientId, productId, queryClient, replace])

  return { state, generate, regenerate, recover, checkStatus, recheckCompleted, dismiss, clear: purge }
}
