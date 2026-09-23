import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import {
  BillingPlanContractError,
  serializeBillingPlanCommandRequest,
} from '../api/billingPlanApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  billingAccountKeys,
  billingSubscriptionKeys,
  clearPrivateClientScope,
  invalidatePlanChangeScopes,
  useBillingPlanChangeMutation,
  useBillingPlanChangePreviewMutation,
} from '../queries/billingQueries'
import type {
  BillingAccountSnapshot,
  BillingSubscriptionPlanChangeAttempt,
  BillingSubscriptionPlanChangePreview,
  BillingSubscriptionPlanChangePreviewRequest,
  BillingSubscriptionPlanChangeReceipt,
  BillingSubscriptionState,
} from '../types/billing'

export type PlanChangePhase =
  | 'idle' | 'previewing' | 'confirmable' | 'revalidating' | 'submitting'
  | 'reconciling' | 'reconciliation_delayed' | 'succeeded' | 'rejected' | 'unknown'

export interface PlanChangeMaterial {
  request: BillingSubscriptionPlanChangePreviewRequest
  reason: string
}

export interface PlanChangeAuthority {
  material: PlanChangeMaterial
  preview: BillingSubscriptionPlanChangePreview
  fingerprint: string
}

export interface PlanChangeFreshState {
  subscription: BillingSubscriptionState
  account: BillingAccountSnapshot | null
}

class FinancialAuthorityChangedError extends Error {
  constructor() {
    super('Financial authority changed before submit. Preview the action again.')
    this.name = 'FinancialAuthorityChangedError'
  }
}

const statusOf = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined

function fingerprint(state: PlanChangeFreshState, preview: BillingSubscriptionPlanChangePreview): string {
  const current = state.subscription.current
  const remainder = state.subscription.pendingImmediateDebit ?? current?.pendingImmediateDebit
  const cycle = state.subscription.immediateChangeContext ?? current?.immediateChangeContext
  return JSON.stringify({
    clientId: state.subscription.clientId,
    subscriptionId: current?.subscriptionId,
    status: current?.status,
    planTermsOperationId: current?.planTermsOperationId,
    updatedAt: current?.updatedAt,
    pendingOperationId: state.subscription.pendingChange &&
      !('status' in state.subscription.pendingChange)
      ? state.subscription.pendingChange.planChangeOperationId
      : state.subscription.pendingChange ? 'unsupported' : null,
    remainderOperationId: remainder && !('status' in remainder)
      ? remainder.planChangeOperationId : remainder ? 'unsupported' : null,
    cycle: cycle && !('status' in cycle)
      ? [cycle.cycleIndex, cycle.cycleStart, cycle.cycleEnd, cycle.grantOperationId ?? null]
      : cycle ? 'unsupported' : null,
    account: state.account ? [state.account.creditAccountId, state.account.status,
      state.account.walletVersion] : null,
    preview: {
      action: preview.action,
      currentTerms: preview.currentTerms,
      targetTerms: preview.targetTerms,
      pendingChangeBefore: preview.pendingChangeBefore,
      pendingResult: preview.pendingResult,
      effectiveCycle: preview.effectiveCycle,
      timing: preview.creditEffect.timing,
    },
  })
}

function authorityAgrees(
  state: BillingSubscriptionState | undefined,
  account: BillingAccountSnapshot | undefined,
  receipt: BillingSubscriptionPlanChangeReceipt
): boolean {
  if (!state?.current || state.clientId !== receipt.clientId ||
      state.current.subscriptionId !== receipt.subscriptionId) return false
  if (receipt.action === 'apply_immediate') {
    return state.current.planTermsOperationId === receipt.planTermsOperationId &&
      account?.creditAccountId === receipt.account.creditAccountId &&
      account.walletVersion === receipt.account.walletVersionAfter
  }
  const pending = state.pendingChange && !('status' in state.pendingChange)
    ? state.pendingChange.planChangeOperationId : null
  return pending === receipt.pendingChangeOperationId
}

export function useSubscriptionPlanChange(
  clientId: string,
  subscriptionId: string,
  options: { uuidFactory?: () => string; onPermissionDenied?: (error: ApiError) => void } = {}
) {
  const queryClient = useQueryClient()
  const previewMutation = useBillingPlanChangePreviewMutation(clientId, subscriptionId)
  const commandMutation = useBillingPlanChangeMutation(clientId, subscriptionId)
  const [phase, setPhase] = useState<PlanChangePhase>('idle')
  const [confirmation, setConfirmation] = useState<PlanChangeAuthority | null>(null)
  const [attempt, setAttempt] = useState<BillingSubscriptionPlanChangeAttempt | null>(null)
  const [result, setResult] = useState<BillingSubscriptionPlanChangeReceipt | null>(null)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const confirmationRef = useRef<PlanChangeAuthority | null>(null)
  const attemptRef = useRef<BillingSubscriptionPlanChangeAttempt | null>(null)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const clientRef = useRef(clientId)
  const subscriptionRef = useRef(subscriptionId)
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  permissionHandlerRef.current = options.onPermissionDenied

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
    const affected = clientRef.current
    clear()
    await clearPrivateClientScope(queryClient, affected)
    permissionHandlerRef.current?.(permissionError)
    if (permissionError.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
  }, [clear, queryClient])

  const clearForNotFound = useCallback(async () => {
    const affected = clientRef.current
    clear()
    await clearPrivateClientScope(queryClient, affected)
  }, [clear, queryClient])

  const clearForContractViolation = useCallback(async () => {
    const affected = clientRef.current
    clear()
    await clearPrivateClientScope(queryClient, affected)
  }, [clear, queryClient])

  useLayoutEffect(() => {
    if (clientRef.current !== clientId || subscriptionRef.current !== subscriptionId) {
      const previous = clientRef.current
      clear()
      clientRef.current = clientId
      subscriptionRef.current = subscriptionId
      void clearPrivateClientScope(queryClient, previous)
    }
  }, [clear, clientId, queryClient, subscriptionId])

  useEffect(() => {
    const reset = (event: Event) => {
      if (event.type === 'auth:refreshed' && inFlightRef.current) return
      clear()
    }
    window.addEventListener('auth:cleared', reset)
    window.addEventListener('auth:refreshed', reset)
    return () => {
      window.removeEventListener('auth:cleared', reset)
      window.removeEventListener('auth:refreshed', reset)
      abortRef.current?.abort()
    }
  }, [clear])

  const prepare = useCallback(async (material: PlanChangeMaterial, fresh: PlanChangeFreshState) => {
    if (inFlightRef.current || !fresh.subscription.current ||
        fresh.subscription.clientId !== clientId ||
        fresh.subscription.current.subscriptionId !== subscriptionId) return false
    const generation = ++generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    confirmationRef.current = null
    setConfirmation(null)
    setError(null)
    setPhase('previewing')
    try {
      const preview = await previewMutation.mutateAsync({ request: material.request, signal: controller.signal })
      if (controller.signal.aborted || generation !== generationRef.current ||
          clientRef.current !== clientId || subscriptionRef.current !== subscriptionId) return false
      const next = Object.freeze({ material: Object.freeze(material), preview,
        fingerprint: fingerprint(fresh, preview) })
      confirmationRef.current = next
      setConfirmation(next)
      setPhase('confirmable')
      return true
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return false
      const status = statusOf(caught)
      if (status === 401 || status === 403) await clearForPermissionLoss(caught as ApiError)
      else if (status === 404) await clearForNotFound()
      else if (caught instanceof BillingPlanContractError) await clearForContractViolation()
      else { setError(caught as Error | ApiError); setPhase('rejected') }
      return false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [clearForContractViolation, clearForNotFound, clearForPermissionLoss, clientId,
    previewMutation, subscriptionId])

  const reconcileAuthority = useCallback(async (targetClientId: string) => {
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: billingSubscriptionKeys.state(targetClientId), exact: true }, { throwOnError: true }),
        queryClient.refetchQueries({ queryKey: billingAccountKeys.account(targetClientId), exact: true }, { throwOnError: true }),
      ])
      return true
    } catch { return false }
  }, [queryClient])

  const send = useCallback(async (activeAttempt: BillingSubscriptionPlanChangeAttempt) => {
    if (inFlightRef.current || attemptRef.current !== activeAttempt ||
        activeAttempt.clientId !== clientRef.current ||
        activeAttempt.subscriptionId !== subscriptionRef.current) return
    inFlightRef.current = true
    const generation = generationRef.current
    const sameContext = () => generation === generationRef.current &&
      activeAttempt.clientId === clientRef.current &&
      activeAttempt.subscriptionId === subscriptionRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('submitting')
    try {
      const receipt = await commandMutation.mutateAsync({ request: activeAttempt.request,
        serializedBody: activeAttempt.serializedBody, signal: controller.signal })
      if (attemptRef.current !== activeAttempt || !sameContext()) return
      setResult(receipt)
      setPhase('reconciling')
      await invalidatePlanChangeScopes(queryClient, activeAttempt.clientId,
        receipt.action === 'apply_immediate')
      const refreshed = await reconcileAuthority(activeAttempt.clientId)
      const state = queryClient.getQueryData<BillingSubscriptionState>(
        billingSubscriptionKeys.state(activeAttempt.clientId))
      const account = queryClient.getQueryData<BillingAccountSnapshot>(
        billingAccountKeys.account(activeAttempt.clientId))
      if (attemptRef.current === activeAttempt && sameContext())
        setPhase(refreshed && authorityAgrees(state, account, receipt)
          ? 'succeeded' : 'reconciliation_delayed')
    } catch (caught) {
      if (attemptRef.current !== activeAttempt || !sameContext()) return
      const nextError = caught as Error | ApiError
      const status = statusOf(nextError)
      setError(nextError)
      if (nextError instanceof BillingPlanContractError) {
        await clearForContractViolation()
      } else if (status === 401 || status === 403) {
        await clearForPermissionLoss(nextError as ApiError)
      } else if (status === 404) {
        await clearPrivateClientScope(queryClient, activeAttempt.clientId)
        if (sameContext()) { attemptRef.current = null; setAttempt(null); setConfirmation(null); setPhase('rejected') }
      } else if (status === 409 || (status !== undefined && status < 500)) {
        await invalidatePlanChangeScopes(queryClient, activeAttempt.clientId, true)
        await reconcileAuthority(activeAttempt.clientId)
        if (sameContext()) {
          attemptRef.current = null
          confirmationRef.current = null
          setAttempt(null)
          setConfirmation(null)
          setPhase('rejected')
        }
      } else {
        setPhase('reconciling')
        await reconcileAuthority(activeAttempt.clientId)
        if (attemptRef.current === activeAttempt && sameContext()) setPhase('unknown')
      }
    } finally {
      if (sameContext()) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearForContractViolation, clearForPermissionLoss, commandMutation, queryClient,
    reconcileAuthority])

  const confirm = useCallback(async (preflight: () => Promise<PlanChangeFreshState | null>) => {
    const frozen = confirmationRef.current
    if (!frozen || phase !== 'confirmable' || inFlightRef.current || attemptRef.current) return
    const generation = generationRef.current
    inFlightRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('revalidating')
    try {
      const fresh = await preflight()
      if (!fresh || controller.signal.aborted || generation !== generationRef.current) return
      const repreview = await previewMutation.mutateAsync({ request: frozen.material.request,
        signal: controller.signal })
      if (controller.signal.aborted || generation !== generationRef.current) return
      if (fingerprint(fresh, repreview) !== frozen.fingerprint)
        throw new FinancialAuthorityChangedError()
      const operationId = uuidFactoryRef.current()
      const request = Object.freeze({ ...frozen.material.request, planChangeOperationId: operationId,
        previewToken: repreview.previewToken, reason: frozen.material.reason })
      const activeAttempt = Object.freeze({ clientId, subscriptionId,
        route: `/api/backoffice/clients/${clientId}/billing/subscriptions/${subscriptionId}/changes`,
        request, serializedBody: serializeBillingPlanCommandRequest(request), operationId })
      attemptRef.current = activeAttempt
      setAttempt(activeAttempt)
      inFlightRef.current = false
      abortRef.current = null
      await send(activeAttempt)
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return
      const status = statusOf(caught)
      if (status === 401 || status === 403) await clearForPermissionLoss(caught as ApiError)
      else if (status === 404) await clearForNotFound()
      else if (caught instanceof BillingPlanContractError) await clearForContractViolation()
      else {
        confirmationRef.current = null
        setConfirmation(null)
        setError(caught as Error | ApiError)
        setPhase('rejected')
      }
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearForContractViolation, clearForNotFound, clearForPermissionLoss, clientId, phase,
    previewMutation, send, subscriptionId])

  const retry = useCallback(async () => {
    const retained = attemptRef.current
    if (!retained || phase !== 'unknown' || inFlightRef.current) return
    await send(retained)
  }, [phase, send])

  const reconcile = useCallback(async () => {
    const activeAttempt = attemptRef.current
    if (!activeAttempt || !result || phase !== 'reconciliation_delayed' || inFlightRef.current) return
    inFlightRef.current = true
    setPhase('reconciling')
    try {
      const refreshed = await reconcileAuthority(activeAttempt.clientId)
      const state = queryClient.getQueryData<BillingSubscriptionState>(billingSubscriptionKeys.state(activeAttempt.clientId))
      const account = queryClient.getQueryData<BillingAccountSnapshot>(billingAccountKeys.account(activeAttempt.clientId))
      setPhase(refreshed && authorityAgrees(state, account, result) ? 'succeeded' : 'reconciliation_delayed')
    } finally { inFlightRef.current = false }
  }, [phase, queryClient, reconcileAuthority, result])

  const abandon = useCallback(async (preflight: () => Promise<PlanChangeFreshState | null>) => {
    if (phase !== 'unknown' || inFlightRef.current) return false
    inFlightRef.current = true
    try {
      const fresh = await preflight()
      if (!fresh) return false
      clear()
      return true
    } finally { inFlightRef.current = false }
  }, [clear, phase])

  const discardIfAuthorityChanged = useCallback((fresh: PlanChangeFreshState) => {
    const frozen = confirmationRef.current
    if (!frozen || fingerprint(fresh, frozen.preview) === frozen.fingerprint) return false
    confirmationRef.current = null
    setConfirmation(null)
    if (!attemptRef.current) setPhase('idle')
    return true
  }, [])

  return { phase, confirmation, attempt, result, error, prepare, confirm, retry,
    reconcile, abandon, clear, clearForPermissionLoss, clearForNotFound,
    discardIfAuthorityChanged }
}
