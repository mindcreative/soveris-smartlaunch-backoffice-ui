import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import {
  BillingSubscriptionContractError,
  serializeCreateBillingSubscriptionRequest,
} from '../api/billingApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  billingAccountKeys,
  billingSubscriptionKeys,
  clearPrivateBillingQueries,
  useCreateBillingSubscription,
} from '../queries/billingQueries'
import type {
  BillingSubscriptionCreationAttempt,
  BillingSubscriptionCreationReceipt,
  CreateBillingSubscriptionMaterial,
  CreateBillingSubscriptionRequest,
} from '../types/billing'

export type SubscriptionCreationOutcome =
  | 'idle'
  | 'submitting'
  | 'created'
  | 'replayed'
  | 'rejected'
  | 'unknown'

interface SubscriptionCreationOptions {
  uuidFactory?: () => string
  onPermissionDenied?: (error: ApiError) => void
}

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined
}

function cloneRequest(
  material: CreateBillingSubscriptionMaterial,
  creationOperationId: string
): CreateBillingSubscriptionRequest {
  const request: CreateBillingSubscriptionRequest = {
    creationOperationId,
    planName: material.planName,
    subscriptionTier: material.subscriptionTier,
    cycleCreditAmount: material.cycleCreditAmount,
    validFrom: material.validFrom,
    validTo: material.validTo,
    changeEffectivePolicy: 'immediate',
    prorationPolicy: 'replace',
    unusedCreditPolicy: 'rollover',
    entitlements: {
      schemaVersion: 1,
      rateLimits: {
        requestsPerMinute: material.entitlements.rateLimits.requestsPerMinute,
        concurrentAiOperations: material.entitlements.rateLimits.concurrentAiOperations,
      },
      featureFlags: {
        contentGeneration: material.entitlements.featureFlags.contentGeneration,
        imageGeneration: material.entitlements.featureFlags.imageGeneration,
      },
    },
  }
  Object.freeze(request.entitlements.rateLimits)
  Object.freeze(request.entitlements.featureFlags)
  Object.freeze(request.entitlements)
  return Object.freeze(request)
}

export function useSubscriptionCreation(
  clientId: string,
  options: SubscriptionCreationOptions = {}
) {
  const queryClient = useQueryClient()
  const mutation = useCreateBillingSubscription(clientId)
  const [attempt, setAttempt] = useState<BillingSubscriptionCreationAttempt | null>(null)
  const [receipt, setReceipt] = useState<BillingSubscriptionCreationReceipt | null>(null)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const [outcome, setOutcome] = useState<SubscriptionCreationOutcome>('idle')
  const attemptRef = useRef<BillingSubscriptionCreationAttempt | null>(null)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeClientRef = useRef(clientId)
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  permissionHandlerRef.current = options.onPermissionDenied

  const clearLocal = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    attemptRef.current = null
    setAttempt(null)
    setReceipt(null)
    setError(null)
    setOutcome('idle')
  }, [])

  useEffect(() => {
    if (activeClientRef.current !== clientId) {
      clearLocal()
      activeClientRef.current = clientId
    }
  }, [clearLocal, clientId])

  useEffect(() => {
    const clearForAuthChange = (event: Event) => {
      if (event.type === 'auth:refreshed' && inFlightRef.current) return
      clearLocal()
      const detail = (event as CustomEvent<{ waitUntil?: (promise: Promise<void>) => void }>).detail
      detail?.waitUntil?.(Promise.resolve())
    }
    window.addEventListener('auth:cleared', clearForAuthChange)
    window.addEventListener('auth:refreshed', clearForAuthChange)
    return () => {
      window.removeEventListener('auth:cleared', clearForAuthChange)
      window.removeEventListener('auth:refreshed', clearForAuthChange)
      abortRef.current?.abort()
    }
  }, [clearLocal])

  const send = useCallback(async (activeAttempt: BillingSubscriptionCreationAttempt) => {
    if (inFlightRef.current || attemptRef.current !== activeAttempt ||
        activeAttempt.clientId !== activeClientRef.current) return
    inFlightRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setOutcome('submitting')
    try {
      const nextReceipt = await mutation.mutateAsync({
        request: activeAttempt.request,
        serializedBody: activeAttempt.serializedBody,
        signal: controller.signal,
      })
      if (attemptRef.current !== activeAttempt || activeAttempt.clientId !== activeClientRef.current) return
      setReceipt(nextReceipt)
      setOutcome(nextReceipt.created ? 'created' : 'replayed')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: billingSubscriptionKeys.state(activeAttempt.clientId), exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: billingAccountKeys.account(activeAttempt.clientId), exact: true,
        }),
      ])
    } catch (caught) {
      if (attemptRef.current !== activeAttempt || activeAttempt.clientId !== activeClientRef.current) return
      const nextError = caught instanceof Error || (caught && typeof caught === 'object')
        ? caught as Error | ApiError
        : new Error('Subscription creation failed')
      const status = errorStatus(nextError)
      if (status === 401 || status === 403) {
        await clearPrivateBillingQueries(queryClient)
        clearLocal()
        permissionHandlerRef.current?.(nextError as ApiError)
        if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        return
      }
      setError(nextError)
      setOutcome(status === undefined || status >= 500 ||
        nextError instanceof BillingSubscriptionContractError ? 'unknown' : 'rejected')
    } finally {
      if (attemptRef.current === activeAttempt) {
        inFlightRef.current = false
        abortRef.current = null
      }
    }
  }, [clearLocal, mutation, queryClient])

  const confirm = useCallback(async (material: CreateBillingSubscriptionMaterial) => {
    if (inFlightRef.current || attemptRef.current) return
    const request = cloneRequest(material, uuidFactoryRef.current())
    const nextAttempt = Object.freeze({
      clientId,
      request,
      serializedBody: serializeCreateBillingSubscriptionRequest(request),
    })
    attemptRef.current = nextAttempt
    setAttempt(nextAttempt)
    await send(nextAttempt)
  }, [clientId, send])

  const retry = useCallback(async () => {
    const retained = attemptRef.current
    if (!retained || outcome !== 'unknown' || inFlightRef.current) return
    await send(retained)
  }, [outcome, send])

  const abandon = useCallback(() => {
    if (inFlightRef.current) return false
    clearLocal()
    return true
  }, [clearLocal])

  return {
    attempt,
    receipt,
    error,
    outcome,
    isSubmitting: outcome === 'submitting',
    confirm,
    retry,
    abandon,
    clear: clearLocal,
  }
}
