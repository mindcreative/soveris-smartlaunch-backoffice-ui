import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import type { ApiError } from '../../api/apiClient'
import { validateCreditAdjustmentReversalReason } from '../../api/billingAdjustmentApi'
import { useCreditAdjustmentReversal } from '../../hooks/useCreditAdjustmentReversal'
import { LocalInstant } from '../../timezone/LocalInstant'
import type {
  CreditAdjustmentHistoryOriginalItem,
  CreditAdjustmentReversalErrorDisposition,
} from '../../types/billing'
import { FormErrorSummary, Modal, type FormFieldError } from '../shared'
import { CreditAmount } from './CreditAmount'

interface CreditAdjustmentReversalWorkflowProps {
  clientId: string
  actorUserId: string
  canAdjust: boolean
  canView: boolean
  selected: CreditAdjustmentHistoryOriginalItem | null
  returnFocusRef: RefObject<HTMLElement | null>
  onClose: () => void
  onPermissionDenied?: (error: ApiError) => void
  onResolved?: (message: string) => void
}

function rejectionMessage(disposition: CreditAdjustmentReversalErrorDisposition | null): string {
  switch (disposition) {
    case 'invalid_request': return 'The request was rejected. Correct the reversal reason and review again.'
    case 'original_not_found': return 'The original adjustment is no longer available. History is being refreshed.'
    case 'already_reversed': return 'The original adjustment already has a reversal. Its relationship is being refreshed.'
    case 'stale_wallet_version': return 'The account changed. Review the refreshed financial evidence before trying again.'
    case 'insufficient_available_credits': return 'Reserved credits make the compensating debit unsafe. Review again after the account changes.'
    case 'balance_overflow': return 'The compensating credit would exceed the supported balance range.'
    case 'account_inactive': return 'The credit account is inactive, so no reversal was applied.'
    case 'version_exhausted': return 'The account has reached its supported wallet-version limit.'
    case 'invalid_original': return 'The original adjustment is not valid reversal evidence. No reversal was applied.'
    case 'operation_conflict': return 'The sealed operation conflicted with different server evidence and was retired.'
    case 'contract_defect': return 'The reversal could not continue because the response contract was invalid.'
    case 'time_zone_not_set': return 'A saved timezone is required. Contact an administrator; no reversal was applied.'
    case 'dependency_unavailable': return 'Authorization is temporarily unavailable. No reversal was applied; review again after service recovery.'
    case 'permission_lost': return 'Reversal permission is no longer available.'
    case 'session_lost': return 'Your session ended. Sign in again before continuing.'
    default: return 'The reversal could not continue safely. Refresh and review authoritative evidence.'
  }
}

function BalanceComparison({ label, current, projected, unchanged = false }: {
  label: string
  current: string
  projected: string
  unchanged?: boolean
}) {
  return <div className="rounded-md border border-gray-200 p-3">
    <dt className="font-semibold text-gray-950">{label}{unchanged ? ' — unchanged' : ''}</dt>
    <dd className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <span><span className="block text-xs text-gray-600">Current</span>
        <CreditAmount value={current} compact /></span>
      <span><span className="block text-xs text-gray-600">Projected</span>
        <CreditAmount value={projected} compact /></span>
    </dd>
  </div>
}

export function CreditAdjustmentReversalWorkflow({
  clientId,
  actorUserId,
  canAdjust,
  canView,
  selected,
  returnFocusRef,
  onClose,
  onPermissionDenied,
  onResolved,
}: CreditAdjustmentReversalWorkflowProps) {
  const reasonId = useId()
  const descriptionId = useId()
  const summaryRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const openedRef = useRef<string | null>(null)
  const activationGenerationRef = useRef(0)
  const announcedRef = useRef<string | null>(null)
  const determinateRefreshRef = useRef<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FormFieldError[]>([])
  const workflow = useCreditAdjustmentReversal({
    clientId, actorUserId, canAdjust, canView, onPermissionDenied,
  })

  const openReversal = workflow.open
  useEffect(() => {
    if (!selected || !canAdjust || !canView || openedRef.current === selected.adjustmentId) return
    const generation = ++activationGenerationRef.current
    queueMicrotask(() => {
      if (activationGenerationRef.current !== generation ||
          openedRef.current === selected.adjustmentId) return
      openedRef.current = selected.adjustmentId
      void openReversal(selected)
    })
    return () => {
      if (activationGenerationRef.current === generation)
        activationGenerationRef.current += 1
    }
  }, [canAdjust, canView, openReversal, selected])

  useEffect(() => {
    if (!selected) openedRef.current = null
  }, [selected])

  useEffect(() => {
    if (workflow.phase !== 'rejected' || fieldErrors.length === 0) return
    requestAnimationFrame(() => summaryRef.current?.focus())
  }, [fieldErrors.length, workflow.phase])

  useEffect(() => {
    if (workflow.phase !== 'success' || !workflow.attempt && !workflow.receipt && !workflow.reconciled)
      return
    const operationId = workflow.receipt?.operationId ?? 'reconciled-operation'
    if (announcedRef.current === operationId) return
    announcedRef.current = operationId
    onResolved?.('The compensating reversal is confirmed. Authoritative Billing evidence was refreshed.')
  }, [onResolved, workflow.attempt, workflow.phase, workflow.receipt, workflow.reconciled])

  useEffect(() => {
    if (workflow.phase !== 'rejected') {
      determinateRefreshRef.current = null
      return
    }
    if (!workflow.disposition || ![
      'already_reversed', 'stale_wallet_version', 'operation_conflict',
    ].includes(workflow.disposition)) return
    const key = `${workflow.disposition}:${workflow.review?.family.original.adjustmentId ?? ''}`
    if (determinateRefreshRef.current === key) return
    determinateRefreshRef.current = key
    onResolved?.('The reversal was not applied. Refreshing authoritative Billing evidence.')
  }, [onResolved, workflow.disposition, workflow.phase, workflow.review?.family.original.adjustmentId])

  const modalOpen = Boolean(workflow.review) && [
    'review', 'revalidating', 'submitting', 'reconciling', 'unknown', 'rejected', 'success',
  ].includes(workflow.phase)
  const activationPending = Boolean(selected && canAdjust && canView &&
    workflow.phase === 'idle' && openedRef.current !== selected.adjustmentId)
  const closeDisabled = workflow.busy || workflow.phase === 'unknown'
  const reasonError = fieldErrors.find((item) => item.fieldId === reasonId)

  const close = () => {
    if (!workflow.cancel()) return
    setFieldErrors([])
    openedRef.current = selected?.adjustmentId ?? null
    onClose()
  }

  const confirm = async () => {
    const trimmed = workflow.reason.trim()
    try {
      validateCreditAdjustmentReversalReason(trimmed)
      setFieldErrors([])
      if (trimmed !== workflow.reason) workflow.setReason(trimmed)
      await workflow.confirm()
    } catch {
      setFieldErrors([{ fieldId: reasonId, label: 'Reversal reason',
        message: 'Enter 1–512 characters with no control characters.' }])
      requestAnimationFrame(() => summaryRef.current?.focus())
    }
  }

  const busyLabel = workflow.phase === 'opening'
    ? 'Loading fresh reversal evidence…'
    : workflow.phase === 'revalidating'
      ? 'Revalidating account and adjustment evidence…'
      : workflow.phase === 'submitting'
        ? 'Submitting the sealed reversal…'
        : workflow.phase === 'reconciling'
          ? 'Reconciling the exact reversal operation…'
          : null

  return <>
    {(activationPending || workflow.phase === 'opening') && <p role="status" aria-live="polite"
      className="state-indicator my-4 rounded-md border border-blue-400 bg-blue-50 p-3 text-sm font-semibold text-blue-950">
      Loading fresh reversal evidence…
    </p>}

    {workflow.phase === 'rejected' && !workflow.review && <div role="alert" tabIndex={-1}
      className="state-indicator my-4 rounded-md border border-red-500 bg-red-50 p-4 text-sm text-red-950">
      <p className="font-semibold">Reversal review unavailable</p>
      <p className="mt-1">{rejectionMessage(workflow.disposition)}</p>
    </div>}

    <Modal isOpen={modalOpen} onClose={close} closeDisabled={closeDisabled}
      closeOnBackdropClick={!closeDisabled} returnFocusRef={returnFocusRef}
      initialFocusRef={cancelRef} title="Review adjustment reversal" size="lg"
      descriptionId={descriptionId} closeLabel="Close reversal review"
      footer={<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {workflow.phase === 'unknown' ? <>
          <button type="button" onClick={() => void workflow.reconcile()} disabled={workflow.busy}
            className="min-h-11 rounded-md border border-amber-800 px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 disabled:opacity-60">
            Reconcile
          </button>
          <button type="button" onClick={() => void workflow.retry()} disabled={workflow.busy}
            className="min-h-11 rounded-md bg-amber-900 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 disabled:opacity-60">
            Retry same operation
          </button>
        </> : workflow.phase === 'success' ?
          <button ref={cancelRef} data-modal-initial-focus type="button" onClick={close}
            className="min-h-11 rounded-md border border-green-800 px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-800">
            Close
          </button> : <>
            <button ref={cancelRef} data-modal-initial-focus type="button" onClick={close}
              disabled={workflow.busy}
              className="min-h-11 rounded-md border border-gray-400 px-4 py-2 font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 disabled:cursor-wait disabled:opacity-60">
              Cancel
            </button>
            <button type="button" onClick={() => void confirm()}
              disabled={workflow.busy || workflow.phase === 'rejected'}
              className="min-h-11 rounded-md bg-red-800 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800 disabled:cursor-wait disabled:opacity-60">
              Confirm reversal
            </button>
          </>}
      </div>}>
      {workflow.review && <div className="min-w-0 space-y-4 text-sm text-gray-800">
        <p id={descriptionId}>
          This appends one immutable compensating adjustment. The original evidence remains unchanged.
        </p>
        <FormErrorSummary ref={summaryRef} errors={fieldErrors} />
        {workflow.error instanceof Error &&
          workflow.error.name === 'CreditAdjustmentReversalChangedError' &&
          <div role="alert" className="state-indicator rounded-md border border-amber-500 bg-amber-50 p-3 font-semibold text-amber-950">
            Financial evidence changed. Review the updated values before confirming again.
          </div>}
        {workflow.phase === 'rejected' &&
          <div role="alert" tabIndex={-1}
            className="state-indicator rounded-md border border-red-500 bg-red-50 p-3 text-red-950">
            <p className="font-semibold">Reversal not applied</p>
            <p className="mt-1">{rejectionMessage(workflow.disposition)}</p>
          </div>}
        <dl className="space-y-2">
          <div><dt className="font-semibold">Client</dt>
            <dd className="break-all font-mono">Selected Client {clientId}</dd></div>
          <div><dt className="font-semibold">Credit account ID</dt>
            <dd className="break-all font-mono">{workflow.review.account.creditAccountId}</dd></div>
          <div><dt className="font-semibold">Original adjustment ID</dt>
            <dd className="break-all font-mono">{workflow.review.family.original.adjustmentId}</dd></div>
          <div><dt className="font-semibold">Original saved time</dt>
            <dd><LocalInstant value={workflow.review.family.original.operationAsOf} /></dd></div>
          <div><dt className="font-semibold">Original reason</dt>
            <dd className="whitespace-pre-wrap break-words">{workflow.review.family.original.reason}</dd></div>
          <div><dt className="font-semibold">Original signed amount</dt>
            <dd><CreditAmount value={workflow.review.family.original.amount} signed compact /></dd></div>
          <div><dt className="font-semibold">Exact compensating amount</dt>
            <dd><CreditAmount value={workflow.review.projection.inverseAmount} signed compact /></dd></div>
          <div><dt className="font-semibold">Account snapshot as of</dt>
            <dd><LocalInstant value={workflow.review.account.asOf} /></dd></div>
          <div><dt className="font-semibold">Adjustment family as of</dt>
            <dd><LocalInstant value={workflow.review.family.asOf} /></dd></div>
        </dl>
        <dl className="grid grid-cols-1 gap-3">
          <BalanceComparison label="Owned balance"
            current={workflow.review.projection.currentOwnedBalance}
            projected={workflow.review.projection.projectedOwnedBalance} />
          <BalanceComparison label="Available balance"
            current={workflow.review.projection.currentAvailableBalance}
            projected={workflow.review.projection.projectedAvailableBalance} />
          <BalanceComparison label="Reserved balance"
            current={workflow.review.projection.currentReservedBalance}
            projected={workflow.review.projection.projectedReservedBalance} unchanged />
        </dl>
        {workflow.phase !== 'success' && <div>
          <label htmlFor={reasonId} className="block font-semibold text-gray-950">Reversal reason</label>
          <p id={`${reasonId}-hint`} className="mt-1 text-gray-600">
            Required new immutable operator evidence, 1–512 characters. It may match the original reason.
          </p>
          <textarea id={reasonId} rows={4} autoComplete="off" value={workflow.reason}
            disabled={workflow.busy || workflow.phase === 'unknown' || workflow.phase === 'rejected'}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={`${reasonId}-hint${reasonError ? ` ${reasonId}-error` : ''}`}
            onChange={(event) => {
              workflow.setReason(event.target.value)
              setFieldErrors([])
            }}
            className="mt-2 min-h-11 w-full resize-y rounded-md border border-gray-400 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 disabled:bg-gray-100" />
          {reasonError && <p id={`${reasonId}-error`}
            className="mt-1 font-medium text-red-800">{reasonError.message}</p>}
        </div>}
        {workflow.phase === 'unknown' && <div role="alert"
          className="state-indicator rounded-md border-2 border-amber-700 bg-amber-50 p-4 text-amber-950">
          <p className="font-semibold">Outcome unknown</p>
          <p className="mt-1">Do not start another reversal. Reconcile authoritative history or retry the exact same sealed operation.</p>
        </div>}
        {workflow.phase === 'success' && <div role="status" aria-live="polite"
          className="state-indicator rounded-md border border-green-700 bg-green-50 p-4 text-green-950">
          <p className="font-semibold">Compensating reversal confirmed</p>
          <p className="mt-1">The immutable reversal is confirmed{workflow.reconciled
            ? ' from exact operation evidence' : ' by its validated receipt'}.</p>
          {workflow.receipt && <dl className="mt-3 space-y-2">
            <div><dt className="font-semibold">Operation ID</dt>
              <dd className="break-all font-mono">{workflow.receipt.operationId}</dd></div>
            <div><dt className="font-semibold">Reversal adjustment ID</dt>
              <dd className="break-all font-mono">{workflow.receipt.reversalAdjustmentId}</dd></div>
            <div><dt className="font-semibold">Confirmed compensating amount</dt>
              <dd><CreditAmount value={workflow.receipt.compensatingAmount} signed compact /></dd></div>
            <div><dt className="font-semibold">Confirmed saved time</dt>
              <dd><LocalInstant value={workflow.receipt.operationAsOf} /></dd></div>
          </dl>}
          {!workflow.evidenceAvailable && <p className="mt-2 font-semibold text-amber-950">
            The confirmation is valid, but refreshed account or family evidence is unavailable.
          </p>}
        </div>}
        {busyLabel && <p role="status" aria-live="polite"
          className="font-semibold text-indigo-800">{busyLabel}</p>}
      </div>}
    </Modal>
  </>
}
