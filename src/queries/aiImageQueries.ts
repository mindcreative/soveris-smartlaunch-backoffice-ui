import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AiImageContractError,
  getAiImageJob,
  mapAiImageProblem,
  postAiImageAdmission,
  postAiImageAdmissionQuote,
  redeemAiImageResult,
  serializeAiImageRequest,
} from '../api/aiImageApi'
import { createUuidV7 } from '../lib/uuidV7'
import type {
  AiImageAdmissionReceipt,
  AiImageAdmissionQuote,
  AiImageGenerationRequest,
  AiImageJob,
  AiImageTargetRole,
} from '../types/aiImages'

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

interface RetainedCommand {
  readonly request: Readonly<AiImageGenerationRequest>
  readonly serializedBody: string
  readonly reviewedCredits: string
}

interface RetainedReview {
  readonly prompt: string
  readonly quote: Readonly<AiImageAdmissionQuote>
}

export interface AiImageQuoteReview {
  targetRole: AiImageTargetRole
  quotedCredits: string
  ruleVersion: string
  issuedAt: string
  expiresAt: string
}

export type AiImageAdmissionPhase =
  | 'idle' | 'requesting_quote' | 'review_ready' | 'submitting' | 'acknowledged'
  | 'validation' | 'insufficient_credits' | 'quote_expired' | 'quote_stale'
  | 'quote_not_available' | 'rate_limited' | 'admission_unknown'
  | 'permission_lost' | 'conflict' | 'unavailable'

export interface AiImageAdmissionState {
  phase: AiImageAdmissionPhase
  receipt: AiImageAdmissionReceipt | null
  quote: AiImageQuoteReview | null
  message: string
  retryAfterUntil: number | null
}

export interface AiImageAdmissionDependencies {
  now: () => number
  uuid: () => string
  quote: typeof postAiImageAdmissionQuote
  post: typeof postAiImageAdmission
}

const admissionDefaults: AiImageAdmissionDependencies = {
  now: Date.now, uuid: createUuidV7, quote: postAiImageAdmissionQuote, post: postAiImageAdmission,
}
const initialAdmission: AiImageAdmissionState = {
  phase: 'idle', receipt: null, quote: null, message: '', retryAfterUntil: null,
}

function equalDecimal(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value
  return normalize(left) === normalize(right)
}

export function useAiImageAdmission({
  actorId, clientId, authorized, dependencies,
}: {
  actorId: string
  clientId: string
  authorized: boolean
  dependencies?: Partial<AiImageAdmissionDependencies>
}) {
  const depsRef = useRef({ ...admissionDefaults, ...dependencies })
  depsRef.current = { ...admissionDefaults, ...dependencies }
  const [state, setState] = useState(initialAdmission)
  const stateRef = useRef(state)
  stateRef.current = state
  const retainedRef = useRef<RetainedCommand | null>(null)
  const reviewRef = useRef<RetainedReview | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const expiryTimerRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const scope = `${actorId}:${clientId}`
  const previousScopeRef = useRef(scope)

  const replace = useCallback((value: AiImageAdmissionState) => {
    stateRef.current = value
    setState(value)
  }, [])
  const clearExpiry = useCallback(() => {
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current)
    expiryTimerRef.current = null
  }, [])
  const clear = useCallback((phase: AiImageAdmissionPhase = 'idle', message = '') => {
    generationRef.current += 1
    clearExpiry()
    controllerRef.current?.abort()
    controllerRef.current = null
    retainedRef.current = null
    reviewRef.current = null
    busyRef.current = false
    replace({ ...initialAdmission, phase, message })
  }, [clearExpiry, replace])

  const discardReview = useCallback(() => clear(), [clear])

  useEffect(() => {
    if (previousScopeRef.current !== scope) {
      previousScopeRef.current = scope
      clear('unavailable', 'The actor or Client changed. The retained image command was cleared.')
    }
  }, [clear, scope])
  useEffect(() => {
    if (!authorized && (stateRef.current.phase !== 'idle' || reviewRef.current || retainedRef.current))
      clear('permission_lost', 'Image submission permission changed. The retained command was cleared.')
  }, [authorized, clear])
  useEffect(() => {
    const boundary = () => {
      clear('permission_lost', 'The session changed. The retained image command was cleared.')
    }
    window.addEventListener('auth:cleared', boundary)
    window.addEventListener('auth:refreshed', boundary)
    window.addEventListener('popstate', boundary)
    return () => {
      window.removeEventListener('auth:cleared', boundary)
      window.removeEventListener('auth:refreshed', boundary)
      window.removeEventListener('popstate', boundary)
    }
  }, [clear])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (stateRef.current.phase !== 'admission_unknown') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => () => {
    generationRef.current += 1
    controllerRef.current?.abort()
    retainedRef.current = null
    reviewRef.current = null
    clearExpiry()
    busyRef.current = false
  }, [clearExpiry])

  const review = useCallback((prompt: string, targetRole: AiImageTargetRole): boolean => {
    const trimmed = prompt.trim()
    if (!authorized || busyRef.current ||
        (stateRef.current.retryAfterUntil !== null && depsRef.current.now() < stateRef.current.retryAfterUntil) ||
        trimmed.length < 1 || trimmed.length > 4_000 ||
        !(['hero', 'feature'] as const).includes(targetRole)) return false
    clearExpiry()
    reviewRef.current = null
    retainedRef.current = null
    generationRef.current += 1
    const generation = generationRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    busyRef.current = true
    replace({ ...initialAdmission, phase: 'requesting_quote', message: 'Requesting a fresh server quote…' })
    void depsRef.current.quote(targetRole, controller.signal).then((quote) => {
      if (generation !== generationRef.current || controller.signal.aborted) return
      busyRef.current = false
      controllerRef.current = null
      if (depsRef.current.now() >= Date.parse(quote.expiresAt)) {
        replace({ ...initialAdmission, phase: 'quote_expired', message: 'The quote expired before it could be reviewed. Request a fresh quote.' })
        return
      }
      reviewRef.current = Object.freeze({ prompt: trimmed, quote: Object.freeze(quote) })
      const publicQuote: AiImageQuoteReview = {
        targetRole: quote.targetRole, quotedCredits: quote.quotedCredits,
        ruleVersion: quote.ruleVersion, issuedAt: quote.issuedAt, expiresAt: quote.expiresAt,
      }
      replace({ ...initialAdmission, phase: 'review_ready', quote: publicQuote, message: 'Review the current server quote before submitting.' })
      expiryTimerRef.current = window.setTimeout(() => {
        if (generation !== generationRef.current || !reviewRef.current) return
        reviewRef.current = null
        expiryTimerRef.current = null
        replace({ ...initialAdmission, phase: 'quote_expired', message: 'The reviewed quote expired. Review the input again to request a new quote.' })
      }, Math.max(0, Date.parse(quote.expiresAt) - depsRef.current.now()))
    }).catch((error) => {
      if (generation !== generationRef.current || controller.signal.aborted || isAbort(error)) return
      busyRef.current = false
      controllerRef.current = null
      const problem = error instanceof AiImageContractError
        ? { kind: 'quote_not_available' as const, message: 'The quote response could not be verified safely.', retryAfterSeconds: null }
        : mapAiImageProblem(error, 'quote')
      const phase: AiImageAdmissionPhase = problem.kind === 'forbidden' || problem.kind === 'authentication_required'
        ? 'permission_lost' : problem.kind === 'insufficient_credits' ? 'insufficient_credits'
          : problem.kind === 'rate_limited' ? 'rate_limited' : 'quote_not_available'
      replace({
        ...initialAdmission, phase, message: problem.message,
        retryAfterUntil: problem.retryAfterSeconds === null ? null : depsRef.current.now() + problem.retryAfterSeconds * 1_000,
      })
      if (phase === 'permission_lost' && problem.kind === 'authentication_required')
        window.dispatchEvent(new CustomEvent('auth:cleared'))
    })
    return true
  }, [authorized, clearExpiry, replace])

  const send = useCallback(async (retained: RetainedCommand, generation: number) => {
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted || generation !== generationRef.current) return
    replace({
      phase: 'submitting', receipt: null, quote: stateRef.current.quote,
      message: 'Submitting one retained image command…', retryAfterUntil: null,
    })
    try {
      const receipt = await depsRef.current.post(retained.serializedBody, controller.signal)
      if (generation !== generationRef.current || controller.signal.aborted) return
      if (!equalDecimal(receipt.quotedCredits, retained.reviewedCredits))
        throw new AiImageContractError('admission credits changed from the reviewed quote')
      retainedRef.current = null
      reviewRef.current = null
      clearExpiry()
      busyRef.current = false
      replace({
        phase: 'acknowledged', receipt, quote: null,
        message: receipt.replay ? 'The previously acknowledged image Job was recovered.' : 'The image Job was acknowledged.',
        retryAfterUntil: null,
      })
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted || isAbort(error)) return
      const problem = error instanceof AiImageContractError
        ? { kind: 'admission_unknown' as const, message: 'The admission response could not be verified safely. Retry only this exact retained command.', retryAfterSeconds: null }
        : mapAiImageProblem(error, 'admission')
      const retain = problem.kind === 'admission_unknown' || problem.kind === 'rate_limited'
      if (!retain) retainedRef.current = null
      busyRef.current = false
      const phase: AiImageAdmissionPhase = problem.kind === 'quote_expired' ? 'quote_expired'
        : problem.kind === 'quote_stale' ? 'quote_stale'
          : problem.kind === 'quote_not_available' ? 'quote_not_available'
            : problem.kind === 'insufficient_credits' ? 'insufficient_credits'
        : problem.kind === 'rate_limited' ? 'rate_limited'
          : problem.kind === 'admission_unknown' ? 'admission_unknown'
            : problem.kind === 'validation' ? 'validation'
              : problem.kind === 'idempotency_conflict' ? 'conflict'
                : problem.kind === 'forbidden' || problem.kind === 'authentication_required' ? 'permission_lost'
                  : 'unavailable'
      if (['quote_expired', 'quote_stale', 'quote_not_available'].includes(phase)) {
        reviewRef.current = null
        clearExpiry()
      }
      replace({
        phase, receipt: null, quote: retain ? stateRef.current.quote : null, message: problem.message,
        retryAfterUntil: problem.retryAfterSeconds === null ? null : depsRef.current.now() + problem.retryAfterSeconds * 1_000,
      })
      if (phase === 'permission_lost') window.dispatchEvent(new CustomEvent('auth:cleared'))
    }
  }, [clearExpiry, replace])

  const confirm = useCallback((prompt: string, targetRole: AiImageTargetRole): boolean => {
    const review = reviewRef.current
    if (!authorized || busyRef.current || retainedRef.current || stateRef.current.receipt ||
        stateRef.current.phase !== 'review_ready' || !review || prompt.trim() !== review.prompt ||
        targetRole !== review.quote.targetRole) return false
    if (depsRef.current.now() >= Date.parse(review.quote.expiresAt)) {
      clear('quote_expired', 'The reviewed quote expired. Review the input again to request a new quote.')
      return false
    }
    try {
      const request = Object.freeze({
        idempotencyKey: depsRef.current.uuid(), prompt: review.prompt,
        targetRole: review.quote.targetRole, quoteId: review.quote.quoteId,
      })
      const retained = Object.freeze({
        request, serializedBody: serializeAiImageRequest(request),
        reviewedCredits: review.quote.quotedCredits,
      })
      retainedRef.current = retained
      reviewRef.current = null
      clearExpiry()
      busyRef.current = true
      generationRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = new AbortController()
      void send(retained, generationRef.current)
      return true
    } catch (error) {
      replace({ ...initialAdmission, phase: 'validation', message: error instanceof Error ? error.message : 'Review the image inputs.' })
      return false
    }
  }, [authorized, clear, clearExpiry, replace, send])

  const recover = useCallback((): boolean => {
    const retained = retainedRef.current
    const current = stateRef.current
    if (!authorized || busyRef.current || !retained || !['admission_unknown', 'rate_limited'].includes(current.phase) ||
        (current.retryAfterUntil !== null && depsRef.current.now() < current.retryAfterUntil)) return false
    busyRef.current = true
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()
    void send(retained, generationRef.current)
    return true
  }, [authorized, send])

  return { state, review, confirm, recover, discardReview, clear }
}

export type AiImageTrackerPhase =
  | 'loading' | 'polling' | 'paused' | 'timeout' | 'completed' | 'failed'
  | 'execution_unknown' | 'permission_lost' | 'not_found' | 'contract_invalid' | 'unavailable'

export type AiImagePreviewPhase = 'idle' | 'loading' | 'ready' | 'expired' | 'denied' | 'error'

export interface AiImageTrackerState {
  phase: AiImageTrackerPhase
  job: AiImageJob | null
  lastCheckedAt: number | null
  message: string
  retryAfterUntil: number | null
  previewPhase: AiImagePreviewPhase
  previewUrl: string | null
}

export interface AiImageTrackerDependencies {
  now: () => number
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  get: typeof getAiImageJob
  redeem: typeof redeemAiImageResult
}

const trackerDefaults: AiImageTrackerDependencies = {
  now: Date.now, sleep: defaultSleep, get: getAiImageJob, redeem: redeemAiImageResult,
}

function publicJob(job: AiImageJob): AiImageJob {
  return { ...job, resultAccess: null }
}

function trackerPhase(job: AiImageJob, automatic: boolean): Pick<AiImageTrackerState, 'phase' | 'message'> {
  if (job.status === 'completed') return {
    phase: 'completed',
    message: job.guidance.code === 'result_expired'
      ? 'Completed. The private result is no longer available.'
      : 'Completed. The private result can be viewed temporarily.',
  }
  if (job.status === 'failed') return { phase: 'failed', message: 'The image Job failed safely. Review the reservation summary before starting any new command.' }
  if (job.status === 'execution_unknown') return { phase: 'execution_unknown', message: 'The outcome needs support or reconciliation. Credits may remain reserved.' }
  if (!automatic) return { phase: 'paused', message: 'Status checked. Automatic checks remain paused.' }
  if (job.status === 'retrying') return { phase: 'polling', message: 'Automatic safe recovery is scheduled or in progress.' }
  if (job.status === 'dlq') return { phase: 'polling', message: 'Recovery is being finalized automatically.' }
  return { phase: 'polling', message: job.status === 'processing' ? 'Processing.' : 'Waiting for processing.' }
}

export function useAiImageJobTracker({
  actorId, clientId, jobId, authorized, dependencies,
}: {
  actorId: string
  clientId: string
  jobId: string
  authorized: boolean
  dependencies?: Partial<AiImageTrackerDependencies>
}) {
  const depsRef = useRef({ ...trackerDefaults, ...dependencies })
  depsRef.current = { ...trackerDefaults, ...dependencies }
  const [state, setState] = useState<AiImageTrackerState>({
    phase: 'loading', job: null, lastCheckedAt: null, message: 'Loading image Job…', retryAfterUntil: null,
    previewPhase: 'idle', previewUrl: null,
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const accessRef = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const previewControllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const busyRef = useRef(false)
  const previewBusyRef = useRef(false)
  const startedAtRef = useRef(depsRef.current.now())
  const deadlineTimerRef = useRef<number | null>(null)
  const scope = `${actorId}:${clientId}:${jobId}`
  const previousScopeRef = useRef(scope)

  const replace = useCallback((next: AiImageTrackerState | ((current: AiImageTrackerState) => AiImageTrackerState)) => {
    setState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      stateRef.current = resolved
      return resolved
    })
  }, [])
  const clearAutomaticDeadline = useCallback(() => {
    if (deadlineTimerRef.current !== null) window.clearTimeout(deadlineTimerRef.current)
    deadlineTimerRef.current = null
  }, [])
  const clearPreview = useCallback(() => {
    previewControllerRef.current?.abort()
    previewControllerRef.current = null
    previewBusyRef.current = false
    accessRef.current = null
    const url = stateRef.current.previewUrl
    if (url) URL.revokeObjectURL(url)
  }, [])
  const purge = useCallback((phase: AiImageTrackerPhase, message: string) => {
    generationRef.current += 1
    clearAutomaticDeadline()
    controllerRef.current?.abort()
    controllerRef.current = null
    busyRef.current = false
    clearPreview()
    replace({ phase, job: null, lastCheckedAt: null, message, retryAfterUntil: null, previewPhase: 'idle', previewUrl: null })
  }, [clearAutomaticDeadline, clearPreview, replace])
  const applyJob = useCallback((job: AiImageJob, automatic: boolean) => {
    clearPreview()
    accessRef.current = job.resultAccess?.reference ?? null
    const presentation = trackerPhase(job, automatic)
    replace((current) => ({
      ...current, ...presentation, job: publicJob(job), lastCheckedAt: depsRef.current.now(), retryAfterUntil: null,
      previewPhase: job.guidance.code === 'result_expired' ? 'expired' : 'idle', previewUrl: null,
    }))
  }, [clearPreview, replace])
  const handleError = useCallback((error: unknown) => {
    clearPreview()
    if (error instanceof AiImageContractError) {
      replace({ phase: 'contract_invalid', job: null, lastCheckedAt: depsRef.current.now(), message: 'The Job response could not be verified safely. Automatic checks stopped.', retryAfterUntil: null, previewPhase: 'idle', previewUrl: null })
      return
    }
    const problem = mapAiImageProblem(error, 'status')
    if (problem.kind === 'authentication_required') {
      purge('permission_lost', problem.message)
      window.dispatchEvent(new CustomEvent('auth:cleared'))
      return
    }
    if (problem.kind === 'forbidden') { purge('permission_lost', problem.message); return }
    if (problem.kind === 'not_found') { purge('not_found', problem.message); return }
    replace((current) => ({
      ...current,
      phase: 'unavailable',
      message: current.job ? `${problem.message} The last verified summary is stale.` : problem.message,
      lastCheckedAt: depsRef.current.now(),
      retryAfterUntil: problem.retryAfterSeconds === null ? null : depsRef.current.now() + problem.retryAfterSeconds * 1_000,
      previewPhase: 'idle', previewUrl: null,
    }))
  }, [clearPreview, purge, replace])

  const pauseAutomaticPolling = useCallback(() => {
    clearAutomaticDeadline()
    busyRef.current = false
    controllerRef.current?.abort()
    controllerRef.current = null
    replace((current) => ({ ...current, phase: 'timeout', message: 'Automatic checks paused after 60 seconds. The Job may continue; use Check status when ready.' }))
  }, [clearAutomaticDeadline, replace])

  const run = useCallback(async (automatic: boolean, generation: number) => {
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted || generation !== generationRef.current) return
    const delays = [1_000, 2_000, 4_000, 8_000, 10_000]
    let delayIndex = 0
    while (generation === generationRef.current && !controller.signal.aborted) {
      if (automatic && depsRef.current.now() - startedAtRef.current >= 60_000) {
        pauseAutomaticPolling()
        return
      }
      try {
        const loaded = await depsRef.current.get(clientId, jobId, controller.signal)
        if (generation !== generationRef.current || controller.signal.aborted) return
        applyJob(loaded, automatic)
        if (!loaded.guidance.poll || !automatic) {
          clearAutomaticDeadline()
          busyRef.current = false
          if (controllerRef.current === controller) controllerRef.current = null
          return
        }
        const delay = delays[Math.min(delayIndex, delays.length - 1)]!
        if (depsRef.current.now() - startedAtRef.current + delay > 60_000) {
          pauseAutomaticPolling()
          return
        }
        await depsRef.current.sleep(delay, controller.signal)
        delayIndex += 1
      } catch (error) {
        if (generation !== generationRef.current || controller.signal.aborted || isAbort(error)) return
        clearAutomaticDeadline()
        busyRef.current = false
        if (controllerRef.current === controller) controllerRef.current = null
        handleError(error)
        return
      }
    }
  }, [applyJob, clearAutomaticDeadline, clientId, handleError, jobId, pauseAutomaticPolling])

  const start = useCallback((automatic: boolean): boolean => {
    if (!authorized || busyRef.current) return false
    const current = stateRef.current
    if (!automatic && current.retryAfterUntil !== null && depsRef.current.now() < current.retryAfterUntil) return false
    busyRef.current = true
    generationRef.current += 1
    const generation = generationRef.current
    clearAutomaticDeadline()
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (automatic) {
      startedAtRef.current = depsRef.current.now()
      deadlineTimerRef.current = window.setTimeout(() => {
        if (generation !== generationRef.current || controllerRef.current !== controller) return
        generationRef.current += 1
        pauseAutomaticPolling()
      }, 60_000)
    }
    replace((value) => ({ ...value, phase: value.job ? 'polling' : 'loading', message: value.job ? 'Checking current Job status…' : 'Loading image Job…' }))
    void run(automatic, generation)
    return true
  }, [authorized, clearAutomaticDeadline, pauseAutomaticPolling, replace, run])

  useLayoutEffect(() => {
    if (previousScopeRef.current !== scope) {
      previousScopeRef.current = scope
      purge('loading', 'Loading image Job for the new scope…')
    }
    if (authorized) start(true)
    else purge('permission_lost', 'Current image tracking permission is unavailable.')
    return () => {
      generationRef.current += 1
      clearAutomaticDeadline()
      controllerRef.current?.abort()
      controllerRef.current = null
      busyRef.current = false
      clearPreview()
    }
  }, [authorized, clearAutomaticDeadline, clearPreview, purge, scope, start])
  useEffect(() => {
    const boundary = () => {
      purge('permission_lost', 'The session or navigation scope changed. Private image state was cleared.')
    }
    window.addEventListener('auth:cleared', boundary)
    window.addEventListener('auth:refreshed', boundary)
    window.addEventListener('popstate', boundary)
    return () => {
      window.removeEventListener('auth:cleared', boundary)
      window.removeEventListener('auth:refreshed', boundary)
      window.removeEventListener('popstate', boundary)
    }
  }, [purge])

  const checkStatus = useCallback(() => start(false), [start])
  const viewResult = useCallback((): boolean => {
    const current = stateRef.current
    const reference = accessRef.current
    const result = current.job?.result
    if (!authorized || previewBusyRef.current || !reference || !result || current.job?.status !== 'completed') return false
    previewBusyRef.current = true
    previewControllerRef.current?.abort()
    const controller = new AbortController()
    previewControllerRef.current = controller
    const generation = generationRef.current
    replace((value) => ({ ...value, previewPhase: 'loading', message: 'Loading the private WebP preview…' }))
    void depsRef.current.redeem(jobId, reference, result.byteSize, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        const prior = stateRef.current.previewUrl
        if (prior) URL.revokeObjectURL(prior)
        accessRef.current = null
        const previewUrl = URL.createObjectURL(blob)
        previewBusyRef.current = false
        replace((value) => ({ ...value, previewPhase: 'ready', previewUrl, message: 'Private preview loaded. It is not attached to a product.' }))
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current || isAbort(error)) return
        accessRef.current = null
        previewBusyRef.current = false
        const problem = error instanceof AiImageContractError
          ? { kind: 'unknown', message: 'The private result bytes could not be verified safely.' }
          : mapAiImageProblem(error, 'redemption')
        const previewPhase: AiImagePreviewPhase = problem.kind === 'result_expired' ? 'expired'
          : problem.kind === 'forbidden' || problem.kind === 'authentication_required' ? 'denied' : 'error'
        if (problem.kind === 'authentication_required') {
          purge('permission_lost', problem.message)
          window.dispatchEvent(new CustomEvent('auth:cleared'))
          return
        }
        if (problem.kind === 'forbidden') {
          purge('permission_lost', problem.message)
          return
        }
        replace((value) => ({ ...value, previewPhase, previewUrl: null, message: problem.message }))
      })
    return true
  }, [authorized, jobId, purge, replace])

  return { state, checkStatus, viewResult, clear: purge }
}
