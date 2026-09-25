import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import { billingApi } from '../api/billingApi'
import {
  BillingAdjustmentContractError,
  calculateCreditAdjustmentReversalProjection,
  classifyCreditAdjustmentReversalError,
  getCreditAdjustmentFamily,
  serializeCreditAdjustmentReversalRequest,
  validateCreditAdjustmentReversalReason,
} from '../api/billingAdjustmentApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  billingAdjustmentKeys,
  clearCreditAdjustmentReversalMutationState,
  clearPrivateClientScope,
  refreshCreditAdjustmentReversalAuthority,
  useCreditAdjustmentReversalMutation,
} from '../queries/billingQueries'
import {
  creditAdjustmentReversalRecoveryStore,
  type CreditAdjustmentReversalRecoveryRecord,
} from '../stores/creditAdjustmentReversalRecoveryStore'
import type {
  BillingAccountSnapshot,
  CreditAdjustmentFamily,
  CreditAdjustmentHistoryOriginalItem,
  CreditAdjustmentReversalAttempt,
  CreditAdjustmentReversalErrorDisposition,
  CreditAdjustmentReversalPhase,
  CreditAdjustmentReversalProjection,
  CreditAdjustmentReversalReceipt,
  CreditAdjustmentReversalRequest,
} from '../types/billing'

export interface UseCreditAdjustmentReversalOptions {
  clientId: string
  actorUserId: string
  canAdjust: boolean
  canView: boolean
  uuidFactory?: () => string
  now?: () => Date
  onPermissionDenied?: (error: ApiError) => void
}

export interface CreditAdjustmentReversalReview {
  account: BillingAccountSnapshot
  family: CreditAdjustmentFamily
  projection: CreditAdjustmentReversalProjection
  semanticFingerprint: string
}

class CreditAdjustmentReversalChangedError extends Error {
  constructor() {
    super('Financial evidence changed. Review the reversal again before confirming.')
    this.name = 'CreditAdjustmentReversalChangedError'
  }
}

const statusOf = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined

function evidenceFingerprint(
  account: BillingAccountSnapshot,
  original: CreditAdjustmentHistoryOriginalItem,
  projection: CreditAdjustmentReversalProjection
): string {
  return JSON.stringify({
    account: {
      clientId: account.clientId,
      creditAccountId: account.creditAccountId,
      ownedBalance: account.ownedBalance,
      activelyReservedAmount: account.activelyReservedAmount,
      availableBalance: account.availableBalance,
      activeReservationCount: account.activeReservationCount,
      status: account.status,
      walletVersion: account.walletVersion,
    },
    original,
    projection,
  })
}

function reviewEvidence(
  clientId: string,
  selected: CreditAdjustmentHistoryOriginalItem,
  account: BillingAccountSnapshot,
  family: CreditAdjustmentFamily
): CreditAdjustmentReversalReview {
  if (account.clientId !== clientId || family.original.adjustmentId !== selected.adjustmentId ||
      family.original.clientId !== clientId || family.original.creditAccountId !== account.creditAccountId ||
      JSON.stringify(family.original) !== JSON.stringify(selected))
    throw new BillingAdjustmentContractError('selected original no longer matches authoritative evidence')
  if (family.reversal)
    throw Object.assign(new Error('This adjustment already has a linked reversal.'), {
      status: 409, code: 'credit_adjustment_already_reversed',
    })
  const projection = calculateCreditAdjustmentReversalProjection(account, family.original)
  if (!projection.advisoryEligible)
    throw Object.assign(new Error('The current account evidence does not permit this reversal.'), {
      status: 409, code: projection.ineligibilityCode,
    })
  return {
    account,
    family,
    projection,
    semanticFingerprint: evidenceFingerprint(account, family.original, projection),
  }
}

function authorityError(result: Awaited<ReturnType<typeof refreshCreditAdjustmentReversalAuthority>>): ApiError | null {
  for (const error of [result.accountError, result.familyError, result.operationError]) {
    const status = statusOf(error)
    if (status === 401 || status === 403) return error as ApiError
  }
  return null
}

function isCompatible(
  record: CreditAdjustmentReversalAttempt,
  clientId: string,
  actorUserId: string,
  canAdjust: boolean,
  canView: boolean
): boolean {
  return canAdjust && canView && record.clientId === clientId && record.actorUserId === actorUserId
}

export function useCreditAdjustmentReversal(options: UseCreditAdjustmentReversalOptions) {
  const { clientId, actorUserId, canAdjust, canView } = options
  const queryClient = useQueryClient()
  const recoveredAtMountRef = useRef<CreditAdjustmentReversalRecoveryRecord | null>(
    canAdjust && canView && actorUserId && clientId
      ? creditAdjustmentReversalRecoveryStore.adoptFirst(actorUserId, clientId)
      : null)
  const recoveredReviewRef = useRef<CreditAdjustmentReversalReview | null>(
    recoveredAtMountRef.current ? {
      account: recoveredAtMountRef.current.account,
      family: {
        original: recoveredAtMountRef.current.original,
        reversal: null,
        asOf: recoveredAtMountRef.current.original.operationAsOf,
      },
      projection: calculateCreditAdjustmentReversalProjection(
        recoveredAtMountRef.current.account, recoveredAtMountRef.current.original),
      semanticFingerprint: recoveredAtMountRef.current.semanticFingerprint,
    } : null)
  const [phase, setPhase] = useState<CreditAdjustmentReversalPhase>(
    recoveredAtMountRef.current ? 'reconciling' : 'idle')
  const [review, setReview] = useState<CreditAdjustmentReversalReview | null>(
    recoveredReviewRef.current)
  const [reason, setReasonState] = useState(recoveredAtMountRef.current?.request.reason ?? '')
  const [attempt, setAttempt] = useState<CreditAdjustmentReversalAttempt | null>(
    recoveredAtMountRef.current)
  const [receipt, setReceipt] = useState<CreditAdjustmentReversalReceipt | null>(null)
  const [reconciled, setReconciled] = useState(false)
  const [evidenceAvailable, setEvidenceAvailable] = useState(true)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const [disposition, setDisposition] = useState<CreditAdjustmentReversalErrorDisposition | null>(null)
  const mutationOriginalAdjustmentId = attempt?.originalAdjustmentId ??
    review?.family.original.adjustmentId ?? recoveredAtMountRef.current?.originalAdjustmentId ?? ''
  const reversalMutation = useCreditAdjustmentReversalMutation(
    clientId, mutationOriginalAdjustmentId)
  const reviewRef = useRef<CreditAdjustmentReversalReview | null>(recoveredReviewRef.current)
  const reasonRef = useRef(recoveredAtMountRef.current?.request.reason ?? '')
  const attemptRef = useRef<CreditAdjustmentReversalRecoveryRecord | null>(recoveredAtMountRef.current)
  const selectedRef = useRef<CreditAdjustmentHistoryOriginalItem | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const mountGenerationRef = useRef(0)
  const scopeRef = useRef({ clientId, actorUserId, canAdjust, canView })
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const nowRef = useRef(options.now ?? (() => new Date()))
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  nowRef.current = options.now ?? (() => new Date())
  permissionHandlerRef.current = options.onPermissionDenied
  scopeRef.current = { clientId, actorUserId, canAdjust, canView }

  const currentScope = useCallback((record?: CreditAdjustmentReversalAttempt | null) => {
    const scope = scopeRef.current
    return mountedRef.current && scope.clientId === clientId && scope.actorUserId === actorUserId &&
      scope.canAdjust && scope.canView && (!record || isCompatible(
        record, clientId, actorUserId, scope.canAdjust, scope.canView))
  }, [actorUserId, clientId])

  const resetVisible = useCallback((clearReason: boolean) => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    reviewRef.current = null
    selectedRef.current = null
    attemptRef.current = null
    setReview(null)
    setAttempt(null)
    setReceipt(null)
    setReconciled(false)
    setEvidenceAvailable(true)
    setError(null)
    setDisposition(null)
    if (clearReason) {
      reasonRef.current = ''
      setReasonState('')
    }
    setPhase('idle')
  }, [])

  const clearReversalScope = useCallback((clearReason: boolean) => {
    creditAdjustmentReversalRecoveryStore.clearScope(actorUserId, clientId)
    void queryClient.cancelQueries({ queryKey: billingAdjustmentKeys.reversal(clientId) })
    queryClient.removeQueries({ queryKey: billingAdjustmentKeys.reversal(clientId) })
    clearCreditAdjustmentReversalMutationState(queryClient, clientId)
    resetVisible(clearReason)
  }, [actorUserId, clientId, queryClient, resetVisible])

  const settleRefresh = useCallback(async (
    record: CreditAdjustmentReversalRecoveryRecord,
    controller: AbortController,
    generation: number
  ) => {
    const refreshed = await refreshCreditAdjustmentReversalAuthority(
      queryClient, record, controller.signal)
    if (controller.signal.aborted || generation !== generationRef.current || !currentScope(record))
      return null
    const denied = authorityError(refreshed)
    if (denied) {
      if (denied.status === 401) {
        clearReversalScope(true)
        await clearPrivateClientScope(queryClient, clientId)
        window.dispatchEvent(new CustomEvent('auth:cleared'))
      } else {
        clearReversalScope(true)
        permissionHandlerRef.current?.(denied)
      }
      return null
    }
    setEvidenceAvailable(!refreshed.accountError && !refreshed.familyError)
    return refreshed
  }, [clearReversalScope, clientId, currentScope, queryClient])

  const reconcileAttempt = useCallback(async (record: CreditAdjustmentReversalRecoveryRecord) => {
    if (inFlightRef.current || !currentScope(record)) return false
    inFlightRef.current = true
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setDisposition(null)
    setPhase('reconciling')
    try {
      const refreshed = await settleRefresh(record, controller, generation)
      if (!refreshed) return false
      if (refreshed.operation?.items[0]) {
        creditAdjustmentReversalRecoveryStore.retire(
          record.actorUserId, record.clientId, record.originalAdjustmentId, record.operationId)
        attemptRef.current = null
        setAttempt(null)
        setReceipt(null)
        setReconciled(true)
        setPhase('success')
        return true
      }
      setReconciled(false)
      setDisposition('ambiguous')
      setPhase('unknown')
      return false
    } catch (caught) {
      if (!controller.signal.aborted && generation === generationRef.current && currentScope(record)) {
        setError(caught as Error | ApiError)
        setDisposition('ambiguous')
        setPhase('unknown')
      }
      return false
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [currentScope, settleRefresh])

  const dispatchAttempt = useCallback(async (record: CreditAdjustmentReversalRecoveryRecord) => {
    if (inFlightRef.current || !currentScope(record)) return false
    inFlightRef.current = true
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setDisposition(null)
    setPhase('submitting')
    try {
      const nextReceipt = await reversalMutation.mutateAsync({
        account: record.account,
        original: record.original,
        request: record.request,
        serializedBody: record.serializedBody,
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== generationRef.current || !currentScope(record))
        return false
      creditAdjustmentReversalRecoveryStore.retire(
        record.actorUserId, record.clientId, record.originalAdjustmentId, record.operationId)
      attemptRef.current = null
      setAttempt(null)
      setReceipt(nextReceipt)
      setReconciled(false)
      setPhase('reconciling')
      try {
        const refreshed = await settleRefresh(record, controller, generation)
        if (refreshed) setPhase('success')
      } catch {
        if (!controller.signal.aborted && generation === generationRef.current && currentScope()) {
          setEvidenceAvailable(false)
          setPhase('success')
        }
      }
      return true
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current || !currentScope(record))
        return false
      const nextDisposition = classifyCreditAdjustmentReversalError(caught)
      if (nextDisposition === 'ambiguous') {
        setError(caught as Error | ApiError)
        setDisposition('ambiguous')
        setPhase('reconciling')
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
        return reconcileAttempt(record)
      }
      creditAdjustmentReversalRecoveryStore.retire(
        record.actorUserId, record.clientId, record.originalAdjustmentId, record.operationId)
      attemptRef.current = null
      setAttempt(null)
      setError(caught as Error | ApiError)
      setDisposition(nextDisposition)
      if (nextDisposition === 'session_lost') {
        clearReversalScope(true)
        await clearPrivateClientScope(queryClient, clientId)
        window.dispatchEvent(new CustomEvent('auth:cleared'))
        return false
      }
      if (nextDisposition === 'permission_lost') {
        clearReversalScope(true)
        permissionHandlerRef.current?.(caught as ApiError)
        return false
      }
      setPhase('rejected')
      void settleRefresh(record, controller, generation)
      return false
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearReversalScope, clientId, currentScope, queryClient, reconcileAttempt,
    reversalMutation, settleRefresh])

  const open = useCallback(async (selected: CreditAdjustmentHistoryOriginalItem) => {
    if (inFlightRef.current || !currentScope()) return false
    inFlightRef.current = true
    const generation = ++generationRef.current
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setPhase('opening')
    setError(null)
    setDisposition(null)
    setReceipt(null)
    setReconciled(false)
    try {
      const [account, family] = await Promise.all([
        billingApi.getAccountSnapshot(clientId, controller.signal),
        getCreditAdjustmentFamily(clientId, selected.adjustmentId, controller.signal),
      ])
      if (controller.signal.aborted || generation !== generationRef.current || !currentScope())
        return false
      const nextReview = reviewEvidence(clientId, selected, account, family)
      selectedRef.current = family.original
      reviewRef.current = nextReview
      setReview(nextReview)
      reasonRef.current = ''
      setReasonState('')
      setPhase('review')
      return true
    } catch (caught) {
      if (!controller.signal.aborted && generation === generationRef.current && currentScope()) {
        setReview(null)
        reviewRef.current = null
        setError(caught as Error | ApiError)
        setDisposition(caught instanceof BillingAdjustmentContractError
          ? 'contract_defect' : classifyCreditAdjustmentReversalError(caught))
        setPhase('rejected')
      }
      return false
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clientId, currentScope])

  const setReason = useCallback((value: string) => {
    reasonRef.current = value
    setReasonState(value)
    setError(null)
  }, [])

  const confirm = useCallback(async () => {
    const reviewed = reviewRef.current
    const selected = selectedRef.current
    if (inFlightRef.current || !reviewed || !selected || !currentScope()) return false
    let validReason: string
    try {
      validReason = validateCreditAdjustmentReversalReason(reasonRef.current.trim())
    } catch (caught) {
      setError(caught as Error)
      setDisposition('invalid_request')
      return false
    }
    inFlightRef.current = true
    const generation = ++generationRef.current
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setPhase('revalidating')
    setError(null)
    setDisposition(null)
    try {
      const [account, family] = await Promise.all([
        billingApi.getAccountSnapshot(clientId, controller.signal),
        getCreditAdjustmentFamily(clientId, selected.adjustmentId, controller.signal),
      ])
      if (controller.signal.aborted || generation !== generationRef.current || !currentScope())
        return false
      const fresh = reviewEvidence(clientId, selected, account, family)
      reviewRef.current = fresh
      selectedRef.current = fresh.family.original
      setReview(fresh)
      if (fresh.semanticFingerprint !== reviewed.semanticFingerprint) {
        setError(new CreditAdjustmentReversalChangedError())
        setPhase('review')
        return false
      }
      const operationId = uuidFactoryRef.current()
      const request: CreditAdjustmentReversalRequest = {
        operationId,
        expectedWalletVersion: fresh.projection.expectedWalletVersion,
        reason: validReason,
      }
      const serializedBody = serializeCreditAdjustmentReversalRequest(request)
      const nextAttempt: CreditAdjustmentReversalAttempt = {
        actorUserId,
        clientId,
        originalAdjustmentId: fresh.family.original.adjustmentId,
        creditAccountId: fresh.account.creditAccountId,
        route: `/api/backoffice/clients/${clientId}/billing/adjustments/${fresh.family.original.adjustmentId}/reversal`,
        operationId,
        request,
        serializedBody,
        semanticFingerprint: fresh.semanticFingerprint,
        dispatchedAt: nowRef.current().toISOString(),
        account: fresh.account,
        original: fresh.family.original,
      }
      const retained = creditAdjustmentReversalRecoveryStore.retain(nextAttempt)
      attemptRef.current = retained
      setAttempt(retained)
      inFlightRef.current = false
      if (abortRef.current === controller) abortRef.current = null
      return dispatchAttempt(retained)
    } catch (caught) {
      if (!controller.signal.aborted && generation === generationRef.current && currentScope()) {
        setError(caught as Error | ApiError)
        setDisposition(caught instanceof BillingAdjustmentContractError
          ? 'contract_defect' : classifyCreditAdjustmentReversalError(caught))
        setPhase('rejected')
      }
      return false
    } finally {
      if (generation === generationRef.current && !attemptRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [actorUserId, clientId, currentScope, dispatchAttempt])

  const retry = useCallback(async () => {
    const record = attemptRef.current
    return record && phase === 'unknown' ? dispatchAttempt(record) : false
  }, [dispatchAttempt, phase])

  const reconcile = useCallback(async () => {
    const record = attemptRef.current
    return record && phase === 'unknown' ? reconcileAttempt(record) : false
  }, [phase, reconcileAttempt])

  const cancel = useCallback(() => {
    if (inFlightRef.current || attemptRef.current) return false
    resetVisible(true)
    return true
  }, [resetVisible])

  useEffect(() => {
    const recovered = recoveredAtMountRef.current
    if (recovered) {
      attemptRef.current = recovered
      void reconcileAttempt(recovered)
    }
  }, [reconcileAttempt])

  useEffect(() => {
    if (canAdjust && canView) return
    clearReversalScope(true)
  }, [canAdjust, canView, clearReversalScope])

  useEffect(() => {
    const onAuthCleared = () => clearReversalScope(true)
    window.addEventListener('auth:cleared', onAuthCleared)
    return () => window.removeEventListener('auth:cleared', onAuthCleared)
  }, [clearReversalScope])

  useEffect(() => {
    const mountGeneration = ++mountGenerationRef.current
    mountedRef.current = true
    const current = attemptRef.current
    if (current) {
      const adopted = creditAdjustmentReversalRecoveryStore.adopt(
        current.actorUserId, current.clientId, current.originalAdjustmentId)
      if (adopted) attemptRef.current = adopted
    }
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      abortRef.current?.abort()
      const record = attemptRef.current
      if (record)
        creditAdjustmentReversalRecoveryStore.quarantine(
          record.actorUserId, record.clientId, record.originalAdjustmentId)
      queueMicrotask(() => {
        if (mountGenerationRef.current !== mountGeneration || mountedRef.current) return
        void queryClient.cancelQueries({ queryKey: billingAdjustmentKeys.reversal(clientId) })
        queryClient.removeQueries({ queryKey: billingAdjustmentKeys.reversal(clientId) })
        clearCreditAdjustmentReversalMutationState(queryClient, clientId)
      })
    }
  }, [clientId, queryClient])

  return {
    phase,
    review,
    reason,
    attempt,
    receipt,
    reconciled,
    evidenceAvailable,
    error,
    disposition,
    busy: phase === 'opening' || phase === 'revalidating' || phase === 'submitting' ||
      phase === 'reconciling',
    open,
    setReason,
    confirm,
    retry,
    reconcile,
    cancel,
  }
}
