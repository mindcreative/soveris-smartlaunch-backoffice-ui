import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import {
  billingApi,
  BillingSubscriptionContractError,
  serializeBillingSubscriptionTierChangeRequest,
} from '../api/billingApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  billingSubscriptionKeys,
  clearPrivateClientScope,
  invalidateTierChangeScopes,
  resourceAccessKeys,
} from '../queries/billingQueries'
import type {
  BillingSubscriptionState,
  BillingSubscriptionTierChangeAttempt,
  BillingSubscriptionTierChangeMaterial,
  BillingSubscriptionTierChangeRequest,
  BillingSubscriptionTierChangeResponse,
  ResourceAccessPreview,
  ResourceAccessPreviewRequest,
} from '../types/billing'

export type TierChangePhase =
  | 'idle' | 'previewing' | 'confirmable' | 'revalidating' | 'submitting' | 'reconciling'
  | 'reconciliation_delayed' | 'succeeded' | 'rejected' | 'unknown' | 'transition_pending'

export interface TierConfirmation {
  material: BillingSubscriptionTierChangeMaterial
  preview: ResourceAccessPreview
  authorityFingerprint: string
}

function statusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined
}

function authorityFingerprint(
  clientId: string,
  subscriptionId: string,
  material: BillingSubscriptionTierChangeMaterial,
  state: BillingSubscriptionState,
  preview: ResourceAccessPreview
): string {
  const current = state.current
  // Immediate execution starts at the server's current time on each preview.
  // Compare stable evidence and affected identities; the command fences policy
  // and source revisions, while its exact grace clock starts at commit.
  const immediate = material.action === 'apply_immediate'
  return JSON.stringify({
    clientId, subscriptionId, action: material.action,
    target: material.subscriptionTier, policy: material.effectivePolicy,
    tier: current?.subscriptionTier, tierRevision: current?.tierRevision,
    status: current?.status, pending: state.pendingTierChange?.operationId ?? null,
    previewPolicyPublicationId: preview.policyPublicationId,
    previewPolicyActivationRevision: preview.policyActivationRevision,
    previewStatusRevision: preview.statusRevision,
    previewClassificationRevision: preview.classificationRevision,
    previewPolicyVersion: preview.policyVersion,
    previewPolicyHash: preview.policyHash,
    commandEffectiveAt: preview.commandEffectiveAt,
    commandAuthorityHash: preview.commandAuthorityHash,
    lossAt: immediate ? null : preview.lossAt,
    accessUntil: immediate ? null : preview.accessUntil,
    earliestProofExpiry: preview.earliestProofExpiry,
    retainedCount: preview.retainedCount, totalCount: preview.totalCount,
    graceCount: preview.graceCount, suspendedCount: preview.suspendedCount,
    deadlineGroups: immediate
      ? preview.deadlineGroups.map(({ graceCount, newlyAffectedCount }) => ({
        graceCount, newlyAffectedCount,
      })) : preview.deadlineGroups,
    deadlineGroupsTruncated: preview.deadlineGroupsTruncated,
    unlistedGraceCount: preview.unlistedGraceCount,
    unlistedNewlyAffectedCount: preview.unlistedNewlyAffectedCount,
    affectedResourcesTruncated: preview.affectedResourcesTruncated,
    affectedResources: immediate
      ? preview.affectedResources.map(({ resourceType, resourceId, disposition, proofExpiresAt }) => ({
        resourceType, resourceId, disposition, proofExpiresAt,
      })) : preview.affectedResources,
    preservationFacts: preview.preservationFacts,
  })
}

function previewMatchesState(
  clientId: string,
  subscriptionId: string,
  state: BillingSubscriptionState,
  preview: ResourceAccessPreview
): boolean {
  return state.clientId === clientId && state.current?.clientId === clientId &&
    state.current.subscriptionId === subscriptionId && preview.clientId === clientId &&
    preview.subscriptionId === subscriptionId &&
    preview.currentSubscriptionTier === state.current.subscriptionTier &&
    preview.tierRevision === state.current.tierRevision &&
    preview.pendingTierChangeOperationId === (state.pendingTierChange?.operationId ?? null)
}

function authorityAgrees(
  state: BillingSubscriptionState | undefined,
  response: BillingSubscriptionTierChangeResponse,
  clientId: string,
  subscriptionId: string
): boolean {
  const observedPending = state?.pendingTierChange?.operationId ?? null
  const resultPending = response.tierState.pendingTierChange?.operationId ?? null
  return Boolean(state?.clientId === clientId && state.current &&
    state.current.subscriptionId === subscriptionId &&
    response.receipt.clientId === clientId && response.receipt.subscriptionId === subscriptionId &&
    state.current.subscriptionTier === response.tierState.subscriptionTier &&
    state.current.tierRevision === response.tierState.tierRevision &&
    state.current.status === response.tierState.status && observedPending === resultPending)
}

export function useSubscriptionTierChange(
  clientId: string,
  subscriptionId: string,
  options: { uuidFactory?: () => string; onPermissionDenied?: (error: ApiError) => void } = {}
) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<TierChangePhase>('idle')
  const [confirmation, setConfirmation] = useState<TierConfirmation | null>(null)
  const [attempt, setAttempt] = useState<BillingSubscriptionTierChangeAttempt | null>(null)
  const [result, setResult] = useState<BillingSubscriptionTierChangeResponse | null>(null)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const confirmationRef = useRef<TierConfirmation | null>(null)
  const attemptRef = useRef<BillingSubscriptionTierChangeAttempt | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const generationRef = useRef(0)
  const activeClientRef = useRef(clientId)
  const activeSubscriptionRef = useRef(subscriptionId)
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  permissionHandlerRef.current = options.onPermissionDenied

  const mutation = useMutation({
    mutationKey: billingSubscriptionKeys.tierChange(clientId, subscriptionId, 'apply_immediate'),
    mutationFn: ({ activeAttempt, signal }: {
      activeAttempt: BillingSubscriptionTierChangeAttempt
      signal: AbortSignal
    }) => billingApi.postSubscriptionTierChange(
      activeAttempt.clientId, activeAttempt.subscriptionId, activeAttempt.action,
      activeAttempt.request, signal, activeAttempt.serializedBody
    ),
    retry: false,
  })

  const clear = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    confirmationRef.current = null
    attemptRef.current = null
    setConfirmation(null)
    setAttempt(null)
    setResult(null)
    setError(null)
    setPhase('idle')
  }, [])

  const clearForPermissionLoss = useCallback(async (permissionError: ApiError) => {
    const affectedClient = activeClientRef.current
    clear()
    await clearPrivateClientScope(queryClient, affectedClient)
    permissionHandlerRef.current?.(permissionError)
    if (permissionError.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
  }, [clear, queryClient])

  const clearForNotFound = useCallback(async () => {
    const affectedClient = activeClientRef.current
    clear()
    await clearPrivateClientScope(queryClient, affectedClient)
  }, [clear, queryClient])

  useLayoutEffect(() => {
    if (activeClientRef.current !== clientId) {
      generationRef.current += 1
      void clearPrivateClientScope(queryClient, activeClientRef.current)
      clear()
      activeClientRef.current = clientId
    }
  }, [clear, clientId, queryClient])

  useLayoutEffect(() => {
    if (activeSubscriptionRef.current !== subscriptionId) {
      clear()
      activeSubscriptionRef.current = subscriptionId
    }
  }, [clear, subscriptionId])

  useEffect(() => {
    const onAuth = (event: Event) => {
      if (event.type === 'auth:refreshed' && inFlightRef.current) return
      generationRef.current += 1
      clear()
    }
    window.addEventListener('auth:cleared', onAuth)
    window.addEventListener('auth:refreshed', onAuth)
    return () => {
      window.removeEventListener('auth:cleared', onAuth)
      window.removeEventListener('auth:refreshed', onAuth)
      abortRef.current?.abort()
    }
  }, [clear])

  const prepare = useCallback(async (
    material: BillingSubscriptionTierChangeMaterial,
    state: BillingSubscriptionState
  ) => {
    if (inFlightRef.current || !state.current || state.clientId !== clientId ||
        state.current.clientId !== clientId || state.current.subscriptionId !== subscriptionId) return false
    generationRef.current += 1
    const generation = generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    confirmationRef.current = null
    setConfirmation(null)
    setError(null)
    setPhase('previewing')
    const previewRequest: ResourceAccessPreviewRequest = {
      action: material.action,
      expectedStatus: state.current.status as 'active' | 'paused',
      expectedTierRevision: state.current.tierRevision,
      subscriptionTier: material.subscriptionTier,
      effectivePolicy: material.effectivePolicy,
    }
    try {
      const preview = await billingApi.getResourceAccessPreview(
        clientId, subscriptionId, previewRequest, controller.signal
      )
      if (controller.signal.aborted || generation !== generationRef.current ||
          clientId !== activeClientRef.current ||
          subscriptionId !== activeSubscriptionRef.current) return false
      if (!previewMatchesState(clientId, subscriptionId, state, preview)) {
        throw new BillingSubscriptionContractError(
          'preview authority does not match the fresh subscription evidence'
        )
      }
      const next = Object.freeze({
        material: Object.freeze({ ...material }), preview,
        authorityFingerprint: authorityFingerprint(
          clientId, subscriptionId, material, state, preview
        ),
      })
      confirmationRef.current = next
      setConfirmation(next)
      setPhase('confirmable')
      return true
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return false
      if (statusOf(caught) === 401 || statusOf(caught) === 403) {
        await clearForPermissionLoss(caught as ApiError)
        return false
      }
      if (statusOf(caught) === 404) {
        await clearForNotFound()
        return false
      }
      setError(caught as Error | ApiError)
      setPhase('rejected')
      return false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [clearForNotFound, clearForPermissionLoss, clientId, subscriptionId])

  const reconcileAuthority = useCallback(async (authorityClientId: string) => {
    try {
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: billingSubscriptionKeys.state(authorityClientId), exact: true,
        }, { throwOnError: true }),
        queryClient.refetchQueries({
          queryKey: resourceAccessKeys.consequences(authorityClientId), exact: true,
        }, { throwOnError: true }),
      ])
      return true
    } catch {
      return false
    }
  }, [queryClient])

  const send = useCallback(async (activeAttempt: BillingSubscriptionTierChangeAttempt) => {
    if (inFlightRef.current || attemptRef.current !== activeAttempt ||
        activeAttempt.clientId !== activeClientRef.current ||
        activeAttempt.subscriptionId !== activeSubscriptionRef.current) return
    inFlightRef.current = true
    const generation = generationRef.current
    const sameContext = () => generation === generationRef.current &&
      activeAttempt.clientId === activeClientRef.current &&
      activeAttempt.subscriptionId === activeSubscriptionRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('submitting')
    try {
      const response = await mutation.mutateAsync({ activeAttempt, signal: controller.signal })
      if (attemptRef.current !== activeAttempt || !sameContext()) return
      setResult(response)
      setPhase('reconciling')
      await invalidateTierChangeScopes(queryClient, activeAttempt.clientId)
      const refreshed = await reconcileAuthority(activeAttempt.clientId)
      const authoritative = queryClient.getQueryData<BillingSubscriptionState>(
        billingSubscriptionKeys.state(activeAttempt.clientId)
      )
      if (attemptRef.current === activeAttempt && sameContext()) setPhase(refreshed && authorityAgrees(
        authoritative, response, activeAttempt.clientId, activeAttempt.subscriptionId
      ) ? 'succeeded' : 'reconciliation_delayed')
    } catch (caught) {
      if (attemptRef.current !== activeAttempt || !sameContext()) return
      const nextError = caught as Error | ApiError
      const status = statusOf(nextError)
      setError(nextError)
      if (status === 401 || status === 403) {
        await clearForPermissionLoss(nextError as ApiError)
        return
      }
      if (status === 404) {
        await clearPrivateClientScope(queryClient, activeAttempt.clientId)
        if (!sameContext() || attemptRef.current !== activeAttempt) return
        confirmationRef.current = null
        setConfirmation(null)
        attemptRef.current = null
        setAttempt(null)
        setPhase('rejected')
        return
      }
      if (status === 409) {
        await invalidateTierChangeScopes(queryClient, activeAttempt.clientId)
        if (!sameContext() || attemptRef.current !== activeAttempt) return
        confirmationRef.current = null
        setConfirmation(null)
        attemptRef.current = null
        setAttempt(null)
        if ((nextError as ApiError).code === 'subscription_tier_change_transition_pending') {
          setPhase('transition_pending')
          for (let poll = 0; poll < 3; poll += 1) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
            if (!sameContext() || attemptRef.current !== null) break
            await reconcileAuthority(activeAttempt.clientId)
          }
        } else {
          setPhase('rejected')
          await reconcileAuthority(activeAttempt.clientId)
        }
      } else {
        const unknown = status === undefined || status >= 500 ||
          nextError instanceof BillingSubscriptionContractError
        if (unknown) {
          setPhase('reconciling')
          await reconcileAuthority(activeAttempt.clientId)
          if (attemptRef.current === activeAttempt && sameContext()) setPhase('unknown')
        } else {
          confirmationRef.current = null
          setConfirmation(null)
          attemptRef.current = null
          setAttempt(null)
          setPhase('rejected')
          await reconcileAuthority(activeAttempt.clientId)
        }
      }
    } finally {
      if (sameContext()) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearForPermissionLoss, mutation, queryClient, reconcileAuthority])

  const confirm = useCallback(async (preflight: () => Promise<BillingSubscriptionState | null>) => {
    const frozen = confirmationRef.current
    if (!frozen || phase !== 'confirmable' || inFlightRef.current || attemptRef.current) return
    const generation = generationRef.current
    inFlightRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('revalidating')
    try {
      const state = await preflight()
      if (controller.signal.aborted || generation !== generationRef.current ||
          clientId !== activeClientRef.current ||
          subscriptionId !== activeSubscriptionRef.current) return
      if (!state?.current || (state.current.status !== 'active' && state.current.status !== 'paused') ||
          authorityFingerprint(clientId, subscriptionId, frozen.material, state, frozen.preview) !==
            frozen.authorityFingerprint) {
        throw new BillingSubscriptionContractError('subscription authority changed before submit')
      }
      const preview = await billingApi.getResourceAccessPreview(clientId, subscriptionId, {
        action: frozen.material.action,
        expectedStatus: state.current.status,
        expectedTierRevision: frozen.material.expectedTierRevision,
        subscriptionTier: frozen.material.subscriptionTier,
        effectivePolicy: frozen.material.effectivePolicy,
      }, controller.signal)
      if (controller.signal.aborted || generation !== generationRef.current ||
          clientId !== activeClientRef.current ||
          subscriptionId !== activeSubscriptionRef.current) return
      if (!previewMatchesState(clientId, subscriptionId, state, preview) ||
          authorityFingerprint(clientId, subscriptionId, frozen.material, state, preview) !==
            frozen.authorityFingerprint) {
        throw new BillingSubscriptionContractError('preview authority changed before submit')
      }
      const operationId = uuidFactoryRef.current()
      const request: BillingSubscriptionTierChangeRequest = {
        operationId,
        expectedTierRevision: frozen.material.expectedTierRevision,
        subscriptionTier: frozen.material.subscriptionTier,
        ...(frozen.material.action === 'replace' || frozen.material.action === 'cancel_pending'
          ? { expectedPendingTierChangeOperationId: frozen.material.expectedPendingTierChangeOperationId }
          : { effectivePolicy: frozen.material.effectivePolicy }),
        reason: frozen.material.reason,
        commandAuthorityHash: preview.commandAuthorityHash!,
      }
      const activeAttempt = Object.freeze({
        clientId, subscriptionId, action: frozen.material.action,
        route: `/api/billing/clients/${clientId}/subscriptions/${subscriptionId}/tier-changes${
          frozen.material.action === 'replace' ? '/pending/replace'
            : frozen.material.action === 'cancel_pending' ? '/pending/cancel' : ''
        }`,
        request: Object.freeze(request),
        serializedBody: serializeBillingSubscriptionTierChangeRequest(
          frozen.material.action, request
        ),
      })
      attemptRef.current = activeAttempt
      setAttempt(activeAttempt)
      inFlightRef.current = false
      abortRef.current = null
      await send(activeAttempt)
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current ||
          clientId !== activeClientRef.current ||
          subscriptionId !== activeSubscriptionRef.current) return
      if (statusOf(caught) === 401 || statusOf(caught) === 403) {
        await clearForPermissionLoss(caught as ApiError)
        return
      }
      if (statusOf(caught) === 404) {
        await clearForNotFound()
        return
      }
      confirmationRef.current = null
      setConfirmation(null)
      setError(caught as Error | ApiError)
      setPhase('rejected')
    } finally {
      if (generation === generationRef.current && clientId === activeClientRef.current &&
          subscriptionId === activeSubscriptionRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearForNotFound, clearForPermissionLoss, clientId, phase, send, subscriptionId])

  const retry = useCallback(async () => {
    const retained = attemptRef.current
    if (!retained || phase !== 'unknown' || inFlightRef.current) return
    await send(retained)
  }, [phase, send])

  const reconcile = useCallback(async () => {
    const activeAttempt = attemptRef.current
    if (!activeAttempt || !result || phase !== 'reconciliation_delayed' || inFlightRef.current) return
    inFlightRef.current = true
    const generation = generationRef.current
    setPhase('reconciling')
    try {
      const refreshed = await reconcileAuthority(activeAttempt.clientId)
      const state = queryClient.getQueryData<BillingSubscriptionState>(
        billingSubscriptionKeys.state(activeAttempt.clientId)
      )
      if (generation === generationRef.current && attemptRef.current === activeAttempt &&
          activeAttempt.clientId === activeClientRef.current &&
          activeAttempt.subscriptionId === activeSubscriptionRef.current) {
        setPhase(refreshed && authorityAgrees(
          state, result, activeAttempt.clientId, activeAttempt.subscriptionId
        ) ? 'succeeded' : 'reconciliation_delayed')
      }
    } finally {
      if (generation === generationRef.current) inFlightRef.current = false
    }
  }, [phase, queryClient, reconcileAuthority, result])

  const discardIfAuthorityChanged = useCallback((
    state: BillingSubscriptionState
  ) => {
    const frozen = confirmationRef.current
    if (!frozen) return false
    const next = authorityFingerprint(
      clientId, subscriptionId, frozen.material, state, frozen.preview
    )
    if (next === frozen.authorityFingerprint) return false
    confirmationRef.current = null
    setConfirmation(null)
    if (!attemptRef.current) setPhase('idle')
    return true
  }, [clientId, subscriptionId])

  return {
    phase, confirmation, attempt, result, error,
    prepare, confirm, retry, reconcile, clear, clearForPermissionLoss, clearForNotFound,
    discardIfAuthorityChanged,
  }
}
