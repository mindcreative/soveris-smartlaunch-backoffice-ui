import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import {
  billingApi,
  BillingSubscriptionContractError,
  serializeBillingSubscriptionLifecycleRequest,
} from '../api/billingApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  billingSubscriptionKeys,
  clearPrivateBillingQueries,
  useBillingSubscriptionLifecycleMutation,
} from '../queries/billingQueries'
import type {
  BillingSubscriptionItem,
  BillingSubscriptionLifecycleAction,
  BillingSubscriptionLifecycleAttempt,
  BillingSubscriptionLifecycleReceipt,
  BillingSubscriptionLifecycleRequest,
  BillingSubscriptionState,
} from '../types/billing'

export type SubscriptionLifecycleOutcome =
  | 'idle'
  | 'preflighting'
  | 'preflight-rejected'
  | 'submitting'
  | 'completed'
  | 'rejected'
  | 'unknown'

export type SubscriptionLifecycleRecovery = 'idle' | 'checking' | 'ready' | 'mismatch' | 'unavailable'

interface SubscriptionLifecycleOptions {
  uuidFactory?: () => string
  onPermissionDenied?: (error: ApiError) => void
}

type Preflight = () => Promise<BillingSubscriptionState | null>

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/

function instantKey(value: string): string {
  const match = INSTANT_PATTERN.exec(value)
  if (!match) return ''
  return `${match.slice(1, 7).join('')}${(match[7] ?? '').padEnd(6, '0')}`
}

function compareInstants(left: string, right: string): number {
  return instantKey(left).localeCompare(instantKey(right))
}

function sameNullableInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return compareInstants(left, right) === 0
}

export function availableSubscriptionLifecycleActions(
  state: BillingSubscriptionState
): BillingSubscriptionLifecycleAction[] {
  const current = state.current
  if (!current) return []
  if (current.status !== 'active' && current.status !== 'paused') return []
  const validityEnded = Boolean(
    current.validTo && compareInstants(current.validTo, state.stateAsOf) <= 0
  )
  if (validityEnded) return ['expire', 'cancel']
  return current.status === 'active' ? ['pause', 'cancel'] : ['reactivate', 'cancel']
}

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined
}

function freezeRequest(
  action: BillingSubscriptionLifecycleAction,
  reason: string,
  expectedStatus: 'active' | 'paused',
  lifecycleOperationId: string
): BillingSubscriptionLifecycleRequest {
  return Object.freeze({ lifecycleOperationId, action, expectedStatus, reason })
}

export function useSubscriptionLifecycle(
  clientId: string,
  options: SubscriptionLifecycleOptions = {}
) {
  const queryClient = useQueryClient()
  const mutation = useBillingSubscriptionLifecycleMutation(clientId)
  const [attempt, setAttempt] = useState<BillingSubscriptionLifecycleAttempt | null>(null)
  const [receipt, setReceipt] = useState<BillingSubscriptionLifecycleReceipt | null>(null)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const [outcome, setOutcome] = useState<SubscriptionLifecycleOutcome>('idle')
  const [recovery, setRecovery] = useState<SubscriptionLifecycleRecovery>('idle')
  const [stateRefreshFailed, setStateRefreshFailed] = useState(false)
  const [stateRefreshPending, setStateRefreshPending] = useState(false)
  const attemptRef = useRef<BillingSubscriptionLifecycleAttempt | null>(null)
  const confirmingRef = useRef(false)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeClientRef = useRef(clientId)
  const generationRef = useRef(0)
  const ownAuthReplayRef = useRef(false)
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  permissionHandlerRef.current = options.onPermissionDenied

  const clearLocal = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    confirmingRef.current = false
    inFlightRef.current = false
    attemptRef.current = null
    setAttempt(null)
    setReceipt(null)
    setError(null)
    setOutcome('idle')
    setRecovery('idle')
    setStateRefreshFailed(false)
    setStateRefreshPending(false)
  }, [])

  useLayoutEffect(() => {
    if (activeClientRef.current !== clientId) {
      clearLocal()
      activeClientRef.current = clientId
    }
  }, [clearLocal, clientId])

  useEffect(() => {
    const clearForAuthChange = (event: Event) => {
      if (event.type === 'auth:refreshed' && ownAuthReplayRef.current) {
        queueMicrotask(() => { ownAuthReplayRef.current = false })
        return
      }
      clearLocal()
      const detail = (event as CustomEvent<{ waitUntil?: (promise: Promise<void>) => void }>).detail
      detail?.waitUntil?.(Promise.resolve())
    }
    window.addEventListener('auth:cleared', clearForAuthChange)
    window.addEventListener('auth:refreshed', clearForAuthChange)
    return () => {
      window.removeEventListener('auth:cleared', clearForAuthChange)
      window.removeEventListener('auth:refreshed', clearForAuthChange)
      generationRef.current += 1
      attemptRef.current = null
      confirmingRef.current = false
      inFlightRef.current = false
      activeClientRef.current = ''
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [clearLocal])

  const denyAccess = useCallback((denied: ApiError) => {
    clearLocal()
    permissionHandlerRef.current?.(denied)
    if (denied.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
    void clearPrivateBillingQueries(queryClient)
  }, [clearLocal, queryClient])

  const isOwnAuthReplayRefresh = useCallback(() => ownAuthReplayRef.current, [])

  const reconcileUnknown = useCallback(async (activeAttempt: BillingSubscriptionLifecycleAttempt) => {
    setRecovery('checking')
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: billingSubscriptionKeys.state(activeAttempt.clientId),
        queryFn: ({ signal }) => billingApi.getSubscriptionState(
          activeAttempt.clientId, { pageSize: 20 }, signal
        ),
        staleTime: 0,
      })
      if (attemptRef.current === activeAttempt &&
          activeAttempt.clientId === activeClientRef.current) {
        const subscriptionInScope = fresh.current?.subscriptionId === activeAttempt.subscriptionId ||
          fresh.subscriptionHistory.some((item) => item.subscriptionId === activeAttempt.subscriptionId)
        setRecovery(subscriptionInScope ? 'ready' : 'mismatch')
      }
    } catch (caught) {
      const status = errorStatus(caught)
      if ((status === 401 || status === 403) &&
          attemptRef.current === activeAttempt &&
          activeAttempt.clientId === activeClientRef.current) {
        denyAccess(caught as ApiError)
        return
      }
      if (attemptRef.current === activeAttempt &&
          activeAttempt.clientId === activeClientRef.current) setRecovery('unavailable')
    }
  }, [denyAccess, queryClient])

  const send = useCallback(async (activeAttempt: BillingSubscriptionLifecycleAttempt) => {
    if (inFlightRef.current || attemptRef.current !== activeAttempt ||
        activeAttempt.clientId !== activeClientRef.current) return
    inFlightRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRecovery('idle')
    setStateRefreshFailed(false)
    setStateRefreshPending(false)
    setOutcome('submitting')
    try {
      const nextReceipt = await mutation.mutateAsync({
        request: activeAttempt.request,
        subscriptionId: activeAttempt.subscriptionId,
        serializedBody: activeAttempt.serializedBody,
        validTo: activeAttempt.validTo,
        signal: controller.signal,
        onAuthReplay: () => { ownAuthReplayRef.current = true },
      })
      ownAuthReplayRef.current = false
      if (attemptRef.current !== activeAttempt ||
          activeAttempt.clientId !== activeClientRef.current) return
      setReceipt(nextReceipt)
      setOutcome('completed')
      inFlightRef.current = false
      abortRef.current = null
      setStateRefreshPending(true)
      try {
        await queryClient.invalidateQueries({
          queryKey: billingSubscriptionKeys.state(activeAttempt.clientId),
          exact: true,
          refetchType: 'none',
        })
        await queryClient.refetchQueries(
          {
            queryKey: billingSubscriptionKeys.state(activeAttempt.clientId),
            exact: true,
            type: 'active',
          },
          { throwOnError: true }
        )
      } catch (caught) {
        const status = errorStatus(caught)
        if (status === 401 || status === 403) {
          denyAccess(caught as ApiError)
          return
        }
        setStateRefreshFailed(true)
      } finally {
        setStateRefreshPending(false)
      }
    } catch (caught) {
      ownAuthReplayRef.current = false
      if (attemptRef.current !== activeAttempt ||
          activeAttempt.clientId !== activeClientRef.current) return
      const nextError = caught instanceof Error || (caught && typeof caught === 'object')
        ? caught as Error | ApiError
        : new Error('Subscription lifecycle command failed')
      const status = errorStatus(nextError)
      if (status === 401 || status === 403) {
        denyAccess(nextError as ApiError)
        return
      }
      inFlightRef.current = false
      abortRef.current = null
      setError(nextError)
      const unknown = status === undefined || status >= 500 ||
        nextError instanceof BillingSubscriptionContractError
      setOutcome(unknown ? 'unknown' : 'rejected')
      if (unknown) await reconcileUnknown(activeAttempt)
      else {
        await queryClient.invalidateQueries({
          queryKey: billingSubscriptionKeys.state(activeAttempt.clientId), exact: true,
        })
      }
    } finally {
      if (attemptRef.current === activeAttempt) {
        inFlightRef.current = false
        abortRef.current = null
      }
    }
  }, [denyAccess, mutation, queryClient, reconcileUnknown])

  const confirm = useCallback(async (
    action: BillingSubscriptionLifecycleAction,
    reason: string,
    selected: BillingSubscriptionItem,
    preflight: Preflight
  ) => {
    if (confirmingRef.current || inFlightRef.current || attemptRef.current) return false
    confirmingRef.current = true
    const generation = generationRef.current
    setOutcome('preflighting')
    setError(null)
    try {
      const fresh = await preflight()
      if (generation !== generationRef.current || activeClientRef.current !== clientId) {
        return false
      }
      const current = fresh?.current
      if (!fresh || fresh.clientId !== clientId || !current ||
          (current.status !== 'active' && current.status !== 'paused') ||
          current.subscriptionId !== selected.subscriptionId ||
          current.status !== selected.status ||
          !sameNullableInstant(current.validTo, selected.validTo) ||
          !availableSubscriptionLifecycleActions(fresh).includes(action)) {
        setOutcome('preflight-rejected')
        return false
      }
      const request = freezeRequest(action, reason, current.status, uuidFactoryRef.current())
      const nextAttempt = Object.freeze({
        clientId,
        subscriptionId: current.subscriptionId,
        request,
        serializedBody: serializeBillingSubscriptionLifecycleRequest(request),
        validTo: current.validTo,
      })
      attemptRef.current = nextAttempt
      setAttempt(nextAttempt)
      await send(nextAttempt)
      return true
    } catch (caught) {
      if (generation !== generationRef.current || activeClientRef.current !== clientId) {
        return false
      }
      const nextError = caught instanceof Error ? caught : new Error('Lifecycle preflight failed')
      setError(nextError)
      setOutcome('preflight-rejected')
      return false
    } finally {
      if (generation === generationRef.current) confirmingRef.current = false
    }
  }, [clientId, send])

  const retryExact = useCallback(async () => {
    const retained = attemptRef.current
    if (!retained || outcome !== 'unknown' || recovery !== 'ready' || inFlightRef.current) return
    await send(retained)
  }, [outcome, recovery, send])

  const abandon = useCallback(async () => {
    const retainedClient = attemptRef.current?.clientId
    if (!retainedClient) return false
    generationRef.current += 1
    const generation = generationRef.current
    abortRef.current?.abort()
    abortRef.current = null
    confirmingRef.current = false
    inFlightRef.current = false
    attemptRef.current = null
    setAttempt(null)
    setReceipt(null)
    setError(null)
    setRecovery('idle')
    setStateRefreshFailed(false)
    setStateRefreshPending(false)
    setOutcome('preflighting')
    try {
      await queryClient.fetchQuery({
        queryKey: billingSubscriptionKeys.state(retainedClient),
        queryFn: ({ signal }) => billingApi.getSubscriptionState(
          retainedClient, { pageSize: 20 }, signal
        ),
        staleTime: 0,
      })
      if (generation === generationRef.current && retainedClient === activeClientRef.current) {
        setOutcome('idle')
      }
    } catch (caught) {
      if (generation !== generationRef.current || retainedClient !== activeClientRef.current) {
        return false
      }
      const status = errorStatus(caught)
      if (status === 401 || status === 403) denyAccess(caught as ApiError)
      else setOutcome('preflight-rejected')
      return false
    }
    return true
  }, [denyAccess, queryClient])

  const retryStateRefresh = useCallback(async () => {
    const retained = attemptRef.current
    if (!retained || !receipt || stateRefreshPending) return false
    const generation = generationRef.current
    setStateRefreshFailed(false)
    setStateRefreshPending(true)
    try {
      await queryClient.fetchQuery({
        queryKey: billingSubscriptionKeys.state(retained.clientId),
        queryFn: ({ signal }) => billingApi.getSubscriptionState(
          retained.clientId, { pageSize: 20 }, signal
        ),
        staleTime: 0,
      })
      return true
    } catch (caught) {
      if (generation !== generationRef.current) return false
      const status = errorStatus(caught)
      if (status === 401 || status === 403) denyAccess(caught as ApiError)
      else setStateRefreshFailed(true)
      return false
    } finally {
      if (generation === generationRef.current) setStateRefreshPending(false)
    }
  }, [denyAccess, queryClient, receipt, stateRefreshPending])

  return {
    attempt, receipt, error, outcome, recovery, stateRefreshFailed, stateRefreshPending,
    isBusy: outcome === 'preflighting' || outcome === 'submitting',
    confirm, retryExact, retryStateRefresh, abandon, clear: clearLocal,
    isOwnAuthReplayRefresh,
  }
}
