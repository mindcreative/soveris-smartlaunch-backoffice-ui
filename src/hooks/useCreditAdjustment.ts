import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/apiClient'
import {
  BillingAdjustmentContractError,
  serializeCreditAdjustmentCommandRequest,
} from '../api/billingAdjustmentApi'
import { createUuidV7 } from '../lib/uuidV7'
import {
  clearCreditAdjustmentMutationState,
  clearPrivateClientScope,
  refreshCreditAdjustmentAuthority,
  useCreditAdjustmentCommandMutation,
  useCreditAdjustmentPreviewMutation,
} from '../queries/billingQueries'
import {
  creditAdjustmentRecoveryStore,
  type CreditAdjustmentRecoveryRecord,
} from '../stores/creditAdjustmentRecoveryStore'
import type {
  CreditAdjustmentAttempt,
  CreditAdjustmentMaterial,
  CreditAdjustmentPhase,
  CreditAdjustmentPreview,
  CreditAdjustmentReceipt,
} from '../types/billing'

export interface UseCreditAdjustmentOptions {
  clientId: string
  creditAccountId: string
  actorUserId: string
  authorized: boolean
  accountDataUpdatedAt: number
  uuidFactory?: () => string
  now?: () => Date
  onPermissionDenied?: (error: ApiError) => void
}

interface ReviewedAdjustment {
  material: CreditAdjustmentMaterial
  preview: CreditAdjustmentPreview
  semanticFingerprint: string
}

class CreditAdjustmentChangedError extends Error {
  constructor() {
    super('Financial evidence changed. Preview and review the adjustment again.')
    this.name = 'CreditAdjustmentChangedError'
  }
}

const statusOf = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined

const codeOf = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : undefined

function previewFingerprint(preview: CreditAdjustmentPreview): string {
  return JSON.stringify({
    clientId: preview.clientId,
    creditAccountId: preview.creditAccountId,
    amount: preview.amount,
    walletVersion: preview.walletVersion,
    currentOwnedBalance: preview.currentOwnedBalance,
    currentReservedBalance: preview.currentReservedBalance,
    currentAvailableBalance: preview.currentAvailableBalance,
    projectedOwnedBalance: preview.projectedOwnedBalance,
    projectedReservedBalance: preview.projectedReservedBalance,
    projectedAvailableBalance: preview.projectedAvailableBalance,
    maximumSafeDebit: preview.maximumSafeDebit,
    minimumAllowedAmount: preview.minimumAllowedAmount,
    walletInvariantEligible: preview.walletInvariantEligible,
    ineligibilityCode: preview.ineligibilityCode,
  })
}

function decimalUnits(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,4}))?$/.exec(value)
  if (!match) return null
  const units = BigInt(match[2]!) * 10_000n + BigInt((match[3] ?? '').padEnd(4, '0'))
  return match[1] ? -units : units
}

function sameCredit(left: unknown, right: string): boolean {
  const leftUnits = decimalUnits(left)
  const rightUnits = decimalUnits(right)
  return leftUnits !== null && rightUnits !== null && leftUnits === rightUnits
}

function receiptMatchesReviewedEvidence(record: CreditAdjustmentRecoveryRecord,
  receipt: CreditAdjustmentReceipt): boolean {
  try {
    const evidence = JSON.parse(record.semanticFingerprint) as Record<string, unknown>
    return evidence.creditAccountId === record.creditAccountId &&
      receipt.creditAccountId === record.creditAccountId &&
      sameCredit(evidence.currentOwnedBalance, receipt.beforeOwnedBalance) &&
      sameCredit(evidence.currentReservedBalance, receipt.beforeReservedBalance) &&
      sameCredit(evidence.currentAvailableBalance, receipt.beforeAvailableBalance) &&
      sameCredit(evidence.projectedOwnedBalance, receipt.afterOwnedBalance) &&
      sameCredit(evidence.projectedReservedBalance, receipt.afterReservedBalance) &&
      sameCredit(evidence.projectedAvailableBalance, receipt.afterAvailableBalance)
  } catch {
    return false
  }
}

const COMMAND_CONFLICT_CODES = new Set([
  'credit_adjustment_operation_conflict',
  'credit_adjustment_stale_wallet_version',
  'credit_account_inactive',
  'credit_adjustment_insufficient_available_credits',
  'credit_balance_overflow',
  'credit_account_version_exhausted',
])

function isDeterminateCommandFailure(error: unknown): boolean {
  const status = statusOf(error)
  const code = codeOf(error)
  if (status === 401 || status === 403 || status === 404) return true
  if (status === 400) return code === 'credit_adjustment_invalid_request'
  if (status === 409) return Boolean(code && COMMAND_CONFLICT_CODES.has(code))
  if (status === 413) return code === 'request_body_too_large'
  if (status === 415) return code === 'unsupported_media_type'
  return status === 503 && code === 'authorization_dependency_unavailable'
}

function authorityError(result: Awaited<ReturnType<typeof refreshCreditAdjustmentAuthority>>): ApiError | null {
  for (const error of [result.accountError, result.historyError]) {
    const status = statusOf(error)
    if (status === 401 || status === 403) return error as ApiError
  }
  return null
}

function instantTicks(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return -1n
  const milliseconds = Date.parse(`${match[1]}${match[3]}`)
  if (Number.isNaN(milliseconds)) return -1n
  return BigInt(milliseconds) * 10_000n + BigInt((match[2] ?? '').padEnd(7, '0'))
}

function previewStillMatches(reviewed: ReviewedAdjustment, fresh: CreditAdjustmentPreview): boolean {
  return previewFingerprint(fresh) === reviewed.semanticFingerprint &&
    instantTicks(fresh.asOf) >= instantTicks(reviewed.preview.asOf)
}

function receiptFromHistory(record: CreditAdjustmentRecoveryRecord,
  history: Awaited<ReturnType<typeof refreshCreditAdjustmentAuthority>>['history']): CreditAdjustmentReceipt | null {
  const item = history?.items[0]
  if (!item || item.operationId !== record.operationId ||
      !receiptMatchesReviewedEvidence(record, item)) return null
  const {
    operationType: _operationType,
    expectedWalletVersion: _expectedWalletVersion,
    originalAdjustmentId: _originalAdjustmentId,
    reversalAdjustmentId: _reversalAdjustmentId,
    ...receipt
  } = item
  return receipt
}

export function useCreditAdjustment(options: UseCreditAdjustmentOptions) {
  const { clientId, creditAccountId, actorUserId, authorized, accountDataUpdatedAt } = options
  const queryClient = useQueryClient()
  const previewMutation = useCreditAdjustmentPreviewMutation(clientId, creditAccountId)
  const commandMutation = useCreditAdjustmentCommandMutation(clientId, creditAccountId)
  const recoveryAtMountRef = useRef<CreditAdjustmentRecoveryRecord | null>(
    authorized && actorUserId && clientId
      ? creditAdjustmentRecoveryStore.peek(actorUserId, clientId)
      : null
  )
  const [amount, setAmountState] = useState('')
  const [reason, setReasonState] = useState('')
  const [phase, setPhase] = useState<CreditAdjustmentPhase>(
    recoveryAtMountRef.current ? 'reconciling' : 'editing'
  )
  const [preview, setPreview] = useState<CreditAdjustmentPreview | null>(null)
  const [attempt, setAttempt] = useState<CreditAdjustmentAttempt | null>(recoveryAtMountRef.current)
  const [receipt, setReceipt] = useState<CreditAdjustmentReceipt | null>(null)
  const [error, setError] = useState<Error | ApiError | null>(null)
  const [accountRefreshFailed, setAccountRefreshFailed] = useState(false)
  const [historyReconciled, setHistoryReconciled] = useState(false)
  const amountRef = useRef('')
  const reasonRef = useRef('')
  const reviewedRef = useRef<ReviewedAdjustment | null>(null)
  const attemptRef = useRef<CreditAdjustmentRecoveryRecord | null>(recoveryAtMountRef.current)
  const receiptRef = useRef<CreditAdjustmentReceipt | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const generationRef = useRef(0)
  const mountGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const authReplayRef = useRef(false)
  const scopeRef = useRef({ clientId, actorUserId, authorized })
  const accountUpdatedRef = useRef(accountDataUpdatedAt)
  const uuidFactoryRef = useRef(options.uuidFactory ?? createUuidV7)
  const nowRef = useRef(options.now ?? (() => new Date()))
  const permissionHandlerRef = useRef(options.onPermissionDenied)
  uuidFactoryRef.current = options.uuidFactory ?? createUuidV7
  nowRef.current = options.now ?? (() => new Date())
  permissionHandlerRef.current = options.onPermissionDenied

  const sameScope = useCallback((record: CreditAdjustmentAttempt) =>
    mountedRef.current && record.clientId === clientId && record.actorUserId === actorUserId &&
    scopeRef.current.clientId === clientId && scopeRef.current.actorUserId === actorUserId &&
    scopeRef.current.authorized && authorized, [actorUserId, authorized, clientId])

  const invalidateReview = useCallback(() => {
    reviewedRef.current = null
    setPreview(null)
    if (!attemptRef.current) setPhase('editing')
  }, [])

  const clearVisible = useCallback((preserveInputs: boolean) => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    reviewedRef.current = null
    attemptRef.current = null
    setPreview(null)
    setAttempt(null)
    receiptRef.current = null
    setReceipt(null)
    setError(null)
    setAccountRefreshFailed(false)
    setHistoryReconciled(false)
    if (!preserveInputs) {
      amountRef.current = ''
      reasonRef.current = ''
      setAmountState('')
      setReasonState('')
    }
    setPhase('editing')
  }, [])

  const quarantineCurrentScope = useCallback(() => {
    creditAdjustmentRecoveryStore.quarantine(actorUserId, clientId)
    clearVisible(false)
    void clearPrivateClientScope(queryClient, clientId)
  }, [actorUserId, clearVisible, clientId, queryClient])

  const reconcileAttempt = useCallback(async (record: CreditAdjustmentRecoveryRecord) => {
    if (inFlightRef.current || !sameScope(record)) return false
    inFlightRef.current = true
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('reconciling')
    try {
      const refreshed = await refreshCreditAdjustmentAuthority(queryClient, record, controller.signal,
        () => { authReplayRef.current = true })
      if (controller.signal.aborted || generation !== generationRef.current || !sameScope(record)) return false
      const denied = authorityError(refreshed)
      if (denied) {
        creditAdjustmentRecoveryStore.quarantine(record.actorUserId, record.clientId)
        clearVisible(false)
        await clearPrivateClientScope(queryClient, record.clientId)
        permissionHandlerRef.current?.(denied)
        if (denied.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        return false
      }
      setAccountRefreshFailed(Boolean(refreshed.accountError))
      const recoveredReceipt = receiptFromHistory(record, refreshed.history)
      if (recoveredReceipt) {
        creditAdjustmentRecoveryStore.retire(record.actorUserId, record.clientId, record.operationId)
        attemptRef.current = null
        setAttempt(null)
        receiptRef.current = recoveredReceipt
        setReceipt(recoveredReceipt)
        setHistoryReconciled(true)
        setPhase('success')
        return true
      }
      setHistoryReconciled(false)
      setPhase('unknown')
      return false
    } finally {
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearVisible, queryClient, sameScope])

  const settleReceipt = useCallback(async (record: CreditAdjustmentRecoveryRecord,
    nextReceipt: CreditAdjustmentReceipt) => {
    creditAdjustmentRecoveryStore.retire(record.actorUserId, record.clientId, record.operationId)
    attemptRef.current = null
    setAttempt(null)
    receiptRef.current = nextReceipt
    setReceipt(nextReceipt)
    setPhase('reconciling')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const refreshed = await refreshCreditAdjustmentAuthority(queryClient, record, controller.signal,
        () => { authReplayRef.current = true })
      if (!sameScope(record)) return
      const denied = authorityError(refreshed)
      if (denied) {
        clearVisible(false)
        await clearPrivateClientScope(queryClient, record.clientId)
        permissionHandlerRef.current?.(denied)
        if (denied.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        return
      }
      setAccountRefreshFailed(Boolean(refreshed.accountError))
      setHistoryReconciled(Boolean(receiptFromHistory(record, refreshed.history)))
      setPhase('success')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [clearVisible, queryClient, sameScope])

  const dispatch = useCallback(async (record: CreditAdjustmentRecoveryRecord) => {
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase('submitting')
    try {
      const nextReceipt = await commandMutation.mutateAsync({
        request: record.request, serializedBody: record.serializedBody, signal: controller.signal,
        onAuthReplay: () => { authReplayRef.current = true },
      })
      if (generation !== generationRef.current || !sameScope(record) ||
          attemptRef.current?.operationId !== record.operationId) return
      if (!receiptMatchesReviewedEvidence(record, nextReceipt))
        throw new BillingAdjustmentContractError('receipt does not match reviewed preview evidence')
      await settleReceipt(record, nextReceipt)
    } catch (caught) {
      if (generation !== generationRef.current || !sameScope(record) ||
          attemptRef.current?.operationId !== record.operationId) return
      const nextError = caught as Error | ApiError
      const status = statusOf(nextError)
      setError(nextError)
      const ambiguous = nextError instanceof BillingAdjustmentContractError ||
        !isDeterminateCommandFailure(nextError)
      if (ambiguous) {
        inFlightRef.current = false
        await reconcileAttempt(record)
      } else {
        if (status === 409) {
          inFlightRef.current = false
          const refreshed = await refreshCreditAdjustmentAuthority(queryClient, record,
            controller.signal, () => { authReplayRef.current = true })
          const denied = authorityError(refreshed)
          if (denied) {
            creditAdjustmentRecoveryStore.retire(record.actorUserId, record.clientId, record.operationId)
            clearVisible(false)
            await clearPrivateClientScope(queryClient, record.clientId)
            permissionHandlerRef.current?.(denied)
            if (denied.status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
            return
          }
        }
        creditAdjustmentRecoveryStore.retire(record.actorUserId, record.clientId, record.operationId)
        attemptRef.current = null
        setAttempt(null)
        reviewedRef.current = null
        setPreview(null)
        if (status === 401 || status === 403) {
          clearVisible(false)
          await clearPrivateClientScope(queryClient, record.clientId)
          permissionHandlerRef.current?.(nextError as ApiError)
          if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
        } else {
          setPhase('rejected')
        }
      }
    } finally {
      clearCreditAdjustmentMutationState(queryClient, record.clientId)
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [clearVisible, commandMutation, queryClient, reconcileAttempt, sameScope, settleReceipt])

  useLayoutEffect(() => {
    const previous = scopeRef.current
    const changed = previous.clientId !== clientId || previous.actorUserId !== actorUserId ||
      previous.authorized !== authorized
    scopeRef.current = { clientId, actorUserId, authorized }
    if (!changed) return
    if (previous.actorUserId && previous.clientId)
      creditAdjustmentRecoveryStore.quarantine(previous.actorUserId, previous.clientId)
    clearVisible(false)
    void clearPrivateClientScope(queryClient, previous.clientId)
  }, [actorUserId, authorized, clearVisible, clientId, queryClient])

  useEffect(() => {
    mountedRef.current = true
    if (!authorized || !actorUserId || !clientId) return
    const adopted = creditAdjustmentRecoveryStore.adopt(actorUserId, clientId)
    if (!adopted) return
    attemptRef.current = adopted
    setAttempt(adopted)
    void reconcileAttempt(adopted)
  }, [actorUserId, authorized, clientId, reconcileAttempt])

  useEffect(() => {
    if (accountUpdatedRef.current === accountDataUpdatedAt) return
    accountUpdatedRef.current = accountDataUpdatedAt
    if (!attemptRef.current && !receiptRef.current && (reviewedRef.current || inFlightRef.current)) {
      generationRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      inFlightRef.current = false
      invalidateReview()
    }
  }, [accountDataUpdatedAt, invalidateReview])

  useEffect(() => {
    const mountGeneration = ++mountGenerationRef.current
    const reset = (event: Event) => {
      if (event.type === 'auth:refreshed') {
        authReplayRef.current = false
        return
      }
      quarantineCurrentScope()
    }
    window.addEventListener('auth:cleared', reset)
    window.addEventListener('auth:refreshed', reset)
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      abortRef.current?.abort()
      if (attemptRef.current) {
        creditAdjustmentRecoveryStore.quarantine(
          attemptRef.current.actorUserId, attemptRef.current.clientId
        )
      }
      window.removeEventListener('auth:cleared', reset)
      window.removeEventListener('auth:refreshed', reset)
      queueMicrotask(() => {
        if (mountGenerationRef.current === mountGeneration)
          void clearPrivateClientScope(queryClient, clientId)
      })
    }
  }, [clientId, queryClient, quarantineCurrentScope])

  const edit = useCallback((field: 'amount' | 'reason', value: string) => {
    if (attemptRef.current) return
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    if (field === 'amount') { amountRef.current = value; setAmountState(value) }
    else { reasonRef.current = value; setReasonState(value) }
    receiptRef.current = null
    setReceipt(null)
    setError(null)
    setAccountRefreshFailed(false)
    setHistoryReconciled(false)
    invalidateReview()
  }, [invalidateReview])

  const setAmount = useCallback((value: string) => edit('amount', value), [edit])
  const setReason = useCallback((value: string) => edit('reason', value), [edit])

  const requestPreview = useCallback(async () => {
    if (!authorized || inFlightRef.current || attemptRef.current) return false
    const generation = ++generationRef.current
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    const material = Object.freeze({ amount: amountRef.current, reason: reasonRef.current })
    setError(null)
    setReceipt(null)
    setPhase('previewing')
    inFlightRef.current = true
    try {
      const nextPreview = await previewMutation.mutateAsync({ request: material,
        signal: controller.signal, onAuthReplay: () => { authReplayRef.current = true } })
      if (controller.signal.aborted || generation !== generationRef.current ||
          scopeRef.current.clientId !== clientId || scopeRef.current.actorUserId !== actorUserId) return false
      const reviewed = Object.freeze({ material, preview: nextPreview,
        semanticFingerprint: previewFingerprint(nextPreview) })
      reviewedRef.current = reviewed
      setPreview(nextPreview)
      setPhase('review')
      return true
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return false
      const status = statusOf(caught)
      if (status === 401 || status === 403) {
        clearVisible(false)
        await clearPrivateClientScope(queryClient, clientId)
        permissionHandlerRef.current?.(caught as ApiError)
        if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
      } else {
        setError(caught as Error | ApiError)
        setPhase('rejected')
      }
      return false
    } finally {
      clearCreditAdjustmentMutationState(queryClient, clientId)
      if (generation === generationRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [actorUserId, authorized, clearVisible, clientId, previewMutation, queryClient])

  const cancelReview = useCallback(() => {
    if (inFlightRef.current || attemptRef.current) return
    setError(null)
    invalidateReview()
  }, [invalidateReview])

  const confirm = useCallback(async () => {
    const reviewed = reviewedRef.current
    if (!reviewed || phase !== 'review' || !reviewed.preview.walletInvariantEligible ||
        inFlightRef.current || attemptRef.current || !authorized) return false
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    inFlightRef.current = true
    setError(null)
    setPhase('revalidating')
    try {
      const fresh = await previewMutation.mutateAsync({ request: reviewed.material,
        signal: controller.signal, onAuthReplay: () => { authReplayRef.current = true } })
      if (controller.signal.aborted || generation !== generationRef.current) return false
      if (!fresh.walletInvariantEligible || !previewStillMatches(reviewed, fresh))
        throw new CreditAdjustmentChangedError()
      const operationId = uuidFactoryRef.current()
      const request = Object.freeze({ operationId, expectedWalletVersion: fresh.walletVersion,
        amount: reviewed.material.amount, reason: reviewed.material.reason })
      const record = creditAdjustmentRecoveryStore.retain(Object.freeze({
        actorUserId, clientId, creditAccountId,
        route: `/api/billing/clients/${clientId}/credit-adjustments`, operationId, request,
        serializedBody: serializeCreditAdjustmentCommandRequest(request),
        semanticFingerprint: reviewed.semanticFingerprint,
        dispatchedAt: nowRef.current().toISOString(),
      }))
      attemptRef.current = record
      setAttempt(record)
      inFlightRef.current = false
      abortRef.current = null
      await dispatch(record)
      return true
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return false
      const status = statusOf(caught)
      if (status === 401 || status === 403) {
        clearVisible(false)
        await clearPrivateClientScope(queryClient, clientId)
        permissionHandlerRef.current?.(caught as ApiError)
        if (status === 401) window.dispatchEvent(new CustomEvent('auth:cleared'))
      } else {
        reviewedRef.current = null
        setPreview(null)
        setError(caught as Error | ApiError)
        setPhase('rejected')
      }
      return false
    } finally {
      clearCreditAdjustmentMutationState(queryClient, clientId)
      if (generation === generationRef.current && !attemptRef.current) {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [actorUserId, authorized, clearVisible, clientId, creditAccountId, dispatch, phase,
    previewMutation, queryClient])

  const retry = useCallback(async () => {
    const record = attemptRef.current
    if (!record || phase !== 'unknown' || inFlightRef.current || !sameScope(record)) return false
    inFlightRef.current = true
    await dispatch(record)
    return true
  }, [dispatch, phase, sameScope])

  const reconcile = useCallback(async () => {
    const record = attemptRef.current
    if (!record || phase !== 'unknown' || inFlightRef.current) return false
    return reconcileAttempt(record)
  }, [phase, reconcileAttempt])

  const startAnother = useCallback(() => {
    if (phase !== 'success' || attemptRef.current || inFlightRef.current) return
    amountRef.current = ''
    reasonRef.current = ''
    setAmountState('')
    setReasonState('')
    receiptRef.current = null
    setReceipt(null)
    setError(null)
    setAccountRefreshFailed(false)
    setHistoryReconciled(false)
    setPhase('editing')
  }, [phase])

  return {
    amount, reason, phase, preview, attempt, receipt, error, accountRefreshFailed,
    historyReconciled, isBusy: inFlightRef.current ||
      phase === 'previewing' || phase === 'revalidating' || phase === 'submitting' || phase === 'reconciling',
    hasUnresolvedAttempt: Boolean(attempt), setAmount, setReason, requestPreview,
    cancelReview, confirm, retry, reconcile, startAnother,
  }
}
