import { useEffect, useId, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { useCreditAdjustment } from '../../hooks/useCreditAdjustment'
import type { BillingAccountSnapshot } from '../../types/billing'
import { FormErrorSummary, Modal, type FormFieldError } from '../shared'
import { CreditAmount } from './CreditAmount'

const AMOUNT = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const ZERO = /^-?0(?:\.0{1,4})?$/

function validate(amount: string, reason: string, amountId: string, reasonId: string): FormFieldError[] {
  const errors: FormFieldError[] = []
  if (!AMOUNT.test(amount) || ZERO.test(amount)) {
    errors.push({ fieldId: amountId, label: 'Adjustment amount',
      message: 'Enter a non-zero signed amount.' })
  }
  if (reason !== reason.trim() || [...reason].length < 1 || [...reason].length > 512 ||
      /\p{Cc}/u.test(reason) || /[\uD800-\uDFFF]/u.test(reason)) {
    errors.push({ fieldId: reasonId, label: 'Reason',
      message: 'Enter 1–512 characters with no leading or trailing whitespace or control characters.' })
  }
  return errors
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as ApiError).code : undefined
}

function safeErrorMessage(error: unknown): string {
  const code = errorCode(error)
  if (error instanceof Error && error.name === 'CreditAdjustmentChangedError')
    return 'The account or preview changed. Review a new preview before confirming.'
  switch (code) {
    case 'credit_adjustment_operation_conflict':
      return 'The operation identity conflicted with different server evidence. The attempt was retired; preview and review again before creating a new adjustment.'
    case 'credit_adjustment_stale_wallet_version':
      return 'The account changed before the adjustment was applied. Refresh, preview, and review again.'
    case 'credit_account_inactive':
      return 'The credit account is inactive. No adjustment was applied.'
    case 'credit_adjustment_insufficient_available_credits':
      return 'Available credits no longer permit this debit. Review the refreshed account before trying again.'
    case 'credit_balance_overflow':
    case 'credit_account_version_exhausted':
      return 'The server rejected this adjustment at a financial safety boundary. No adjustment was applied.'
    case 'authorization_dependency_unavailable':
      return 'Authorization could not be confirmed. No adjustment was applied; try a new preview later.'
    case 'invalid_credit_adjustment_preview':
    case 'credit_adjustment_invalid_request':
      return 'The server rejected the adjustment details. Correct the fields and request a new preview.'
    default:
      return 'The adjustment could not continue safely. Review the account and request a new preview.'
  }
}

function BalanceComparison({ label, current, projected, unchanged = false }: {
  label: string
  current: string
  projected: string
  unchanged?: boolean
}) {
  return (
    <div className="min-w-0 rounded-md border border-line p-3">
      <dt className="font-semibold text-foreground">{label}{unchanged ? ' — unchanged' : ''}</dt>
      <dd className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <span className="min-w-0"><span className="block text-xs text-muted">Current</span>
          <CreditAmount value={current} compact /></span>
        <span className="min-w-0"><span className="block text-xs text-muted">Projected</span>
          <CreditAmount value={projected} compact /></span>
      </dd>
    </div>
  )
}

export function CreditAdjustmentWorkflow({ clientId, snapshot, accountDataUpdatedAt,
  actorUserId, onPermissionDenied }: {
  clientId: string
  snapshot: BillingAccountSnapshot
  accountDataUpdatedAt: number
  actorUserId: string
  onPermissionDenied?: (error: ApiError) => void
}) {
  const amountId = useId()
  const reasonId = useId()
  const amountErrorId = `${amountId}-error`
  const reasonErrorId = `${reasonId}-error`
  const modalDescriptionId = useId()
  const [expanded, setExpanded] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FormFieldError[]>([])
  const summaryRef = useRef<HTMLDivElement>(null)
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const workflow = useCreditAdjustment({
    clientId, creditAccountId: snapshot.creditAccountId, actorUserId, authorized: true,
    accountDataUpdatedAt, onPermissionDenied,
  })
  const modalOpen = workflow.phase === 'review' || workflow.phase === 'revalidating' ||
    workflow.phase === 'submitting'

  useEffect(() => {
    if (workflow.hasUnresolvedAttempt || workflow.phase === 'unknown' || workflow.phase === 'success')
      setExpanded(true)
  }, [workflow.hasUnresolvedAttempt, workflow.phase])

  useEffect(() => {
    if (workflow.phase !== 'rejected') return

    const code = errorCode(workflow.error)
    let errors: FormFieldError[] = []
    if (code === 'invalid_credit_adjustment_preview' || code === 'credit_adjustment_invalid_request') {
      errors = [
        { fieldId: amountId, label: 'Adjustment amount', message: 'Review the exact amount accepted by the server.' },
        { fieldId: reasonId, label: 'Reason', message: 'Review the exact reason accepted by the server.' },
      ]
    } else if (code === 'request_body_too_large') {
      errors = [{ fieldId: reasonId, label: 'Reason', message: 'Shorten the reason and request a new preview.' }]
    }

    if (errors.length > 0) {
      setFieldErrors(errors)
    }
  }, [amountId, reasonId, workflow.error, workflow.phase])

  useEffect(() => {
    if (workflow.phase === 'rejected' && fieldErrors.length > 0)
      summaryRef.current?.focus()
  }, [fieldErrors, workflow.phase])

  const amountError = fieldErrors.find((item) => item.fieldId === amountId)
  const reasonError = fieldErrors.find((item) => item.fieldId === reasonId)

  const requestPreview = async () => {
    const errors = validate(workflow.amount, workflow.reason, amountId, reasonId)
    setFieldErrors(errors)
    if (errors.length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    await workflow.requestPreview()
  }

  const busyLabel = workflow.phase === 'revalidating'
    ? 'Revalidating the reviewed adjustment…'
    : workflow.phase === 'submitting'
      ? 'Submitting the sealed adjustment…'
      : workflow.phase === 'previewing'
        ? 'Requesting an authoritative preview…'
        : workflow.phase === 'reconciling'
          ? 'Reconciling the adjustment outcome…'
          : null

  return (
    <section aria-labelledby="credit-adjustment-heading" className="mt-6 min-w-0 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="credit-adjustment-heading" className="text-lg font-semibold text-foreground">Credit adjustment</h2>
          <p className="mt-1 text-sm text-muted">Positive amounts add owned credits. Negative amounts remove owned credits subject to available-balance safety.</p>
        </div>
        {!expanded && (
          <button type="button" onClick={() => setExpanded(true)} disabled={workflow.hasUnresolvedAttempt}
            className="min-h-11 rounded-md bg-primary-hover px-4 py-2 text-sm font-semibold text-on-accent hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60">
            Adjust credits
          </button>
        )}
      </div>

      {expanded && !workflow.receipt && (
        <form className="mt-5 min-w-0 space-y-4" onSubmit={(event) => {
          event.preventDefault(); void requestPreview()
        }} noValidate>
          <FormErrorSummary ref={summaryRef} errors={fieldErrors} />
          <div>
            <label htmlFor={amountId} className="block text-sm font-semibold text-foreground">Adjustment amount</label>
            <p id={`${amountId}-hint`} className="mt-1 text-sm text-muted">Use exact abstract credits with up to four decimal places; include a minus sign to remove credits.</p>
            <input id={amountId} name="adjustmentAmount" type="text" inputMode="decimal"
              autoComplete="off" value={workflow.amount} disabled={workflow.isBusy || workflow.hasUnresolvedAttempt}
              aria-invalid={Boolean(amountError)}
              aria-describedby={`${amountId}-hint${amountError ? ` ${amountErrorId}` : ''}`}
              onChange={(event) => {
                workflow.setAmount(event.target.value)
                setFieldErrors((current) => current.filter((item) => item.fieldId !== amountId))
              }}
              className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-control px-3 py-2 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:bg-subtle" />
            {amountError && <p id={amountErrorId} className="mt-1 text-sm font-medium text-danger">{amountError.message}</p>}
          </div>
          <div>
            <label htmlFor={reasonId} className="block text-sm font-semibold text-foreground">Reason</label>
            <p id={`${reasonId}-hint`} className="mt-1 text-sm text-muted">Required immutable operator evidence, 1–512 characters.</p>
            <textarea id={reasonId} name="adjustmentReason" rows={4}
              autoComplete="off" value={workflow.reason} disabled={workflow.isBusy || workflow.hasUnresolvedAttempt}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={`${reasonId}-hint${reasonError ? ` ${reasonErrorId}` : ''}`}
              onChange={(event) => {
                workflow.setReason(event.target.value)
                setFieldErrors((current) => current.filter((item) => item.fieldId !== reasonId))
              }}
              className="mt-2 min-h-11 w-full min-w-0 resize-y rounded-md border border-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:bg-subtle" />
            {reasonError && <p id={reasonErrorId} className="mt-1 text-sm font-medium text-danger">{reasonError.message}</p>}
          </div>
          <button ref={previewButtonRef} type="submit" disabled={workflow.isBusy || workflow.hasUnresolvedAttempt}
            className="min-h-11 max-w-full break-words rounded-md bg-primary-hover px-4 py-2 text-sm font-semibold text-on-accent hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-60">
            {workflow.phase === 'previewing' ? 'Previewing…' : 'Preview adjustment'}
          </button>
        </form>
      )}

      {busyLabel && !modalOpen && !workflow.receipt && <p role="status" aria-live="polite" className="mt-4 text-sm font-semibold text-primary">{busyLabel}</p>}

      {workflow.phase === 'rejected' && workflow.error && fieldErrors.length === 0 && (
        <div role="alert" className="state-indicator mt-4 rounded-md border border-danger-line bg-danger-soft p-4 text-sm text-danger">
          <p className="font-semibold">Adjustment not applied</p><p className="mt-1">{safeErrorMessage(workflow.error)}</p>
        </div>
      )}

      {workflow.phase === 'unknown' && (
        <div role="alert" className="state-indicator mt-4 rounded-md border-2 border-warning-line bg-warning-soft p-4 text-sm text-warning">
          <p className="font-semibold">Adjustment outcome is not yet known</p>
          <p className="mt-1">Do not create another adjustment. Reconcile authoritative history or retry the exact sealed request.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => void workflow.reconcile()} disabled={workflow.isBusy}
              className="min-h-11 rounded-md border border-warning-line px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning disabled:opacity-60">Reconcile outcome</button>
            <button type="button" onClick={() => void workflow.retry()} disabled={workflow.isBusy}
              className="min-h-11 rounded-md bg-warning-solid px-4 py-2 font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning disabled:opacity-60">Retry exact adjustment</button>
          </div>
        </div>
      )}

      {workflow.receipt && (
        <div role="status" aria-live="polite" className="state-indicator mt-5 min-w-0 rounded-md border border-success-line bg-success-soft p-4 text-sm text-success">
          <h3 className="font-semibold">Credit adjustment committed</h3>
          <p className="mt-2">The validated receipt confirms the immutable operation.</p>
          <dl className="mt-3 space-y-2">
            <div><dt className="font-semibold">Adjustment</dt><dd><CreditAmount value={workflow.receipt.amount} signed compact /></dd></div>
            <div><dt className="font-semibold">Reason</dt><dd className="break-words">{workflow.receipt.reason}</dd></div>
            <div><dt className="font-semibold">Operation ID</dt><dd className="break-all font-mono">{workflow.receipt.operationId}</dd></div>
          </dl>
          {workflow.phase === 'reconciling'
            ? <p className="mt-3 font-semibold text-primary">Receipt validated. Refreshing the authoritative Account and operation history…</p>
            : workflow.accountRefreshFailed
              ? <p className="mt-3 font-semibold text-warning">The receipt is valid, but the authoritative Account refresh failed. Displayed snapshot values may be stale.</p>
              : <p className="mt-3">The authoritative Account refresh completed.</p>}
          {workflow.phase === 'success' && <button type="button" onClick={workflow.startAnother}
            className="mt-4 min-h-11 rounded-md border border-success-line px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success">
            Start another adjustment
          </button>}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={workflow.cancelReview} title="Confirm credit adjustment"
        descriptionId={modalDescriptionId} initialFocusRef={cancelButtonRef}
        returnFocusRef={previewButtonRef} closeDisabled={workflow.isBusy}
        closeOnBackdropClick={!workflow.isBusy} closeLabel="Close confirmation" size="lg"
        footer={<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={cancelButtonRef} data-modal-initial-focus type="button" onClick={workflow.cancelReview}
            disabled={workflow.isBusy}
            className="min-h-11 rounded-md border border-control px-4 py-2 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => void workflow.confirm()}
            disabled={workflow.isBusy || !workflow.preview?.walletInvariantEligible}
            className="min-h-11 rounded-md bg-primary-hover px-4 py-2 font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60">Confirm adjustment</button>
        </div>}>
        {workflow.preview && <div className="min-w-0 space-y-4 text-sm text-foreground">
          <p id={modalDescriptionId}>Confirm changes the owned balance and creates immutable adjustment, ledger, and audit evidence. Cancel changes nothing.</p>
          <dl className="space-y-2">
            <div><dt className="font-semibold">Client</dt><dd className="break-all font-mono">{clientId}</dd></div>
            <div><dt className="font-semibold">Credit account</dt><dd className="break-all font-mono">{workflow.preview.creditAccountId}</dd></div>
            <div><dt className="font-semibold">Signed adjustment</dt><dd><CreditAmount value={workflow.preview.amount} signed compact /></dd></div>
            <div><dt className="font-semibold">Exact reason</dt><dd className="break-words whitespace-pre-wrap">{workflow.preview.reason}</dd></div>
            <div><dt className="font-semibold">Preview as of</dt><dd><time dateTime={workflow.preview.asOf}>{workflow.preview.asOf}</time></dd></div>
          </dl>
          <dl className="grid min-w-0 grid-cols-1 gap-3">
            <BalanceComparison label="Owned balance" current={workflow.preview.currentOwnedBalance} projected={workflow.preview.projectedOwnedBalance} />
            <BalanceComparison label="Available balance" current={workflow.preview.currentAvailableBalance} projected={workflow.preview.projectedAvailableBalance} />
            <BalanceComparison label="Reserved balance" current={workflow.preview.currentReservedBalance} projected={workflow.preview.projectedReservedBalance} unchanged />
          </dl>
          {workflow.preview.walletInvariantEligible
            ? <p className="state-indicator rounded-md border border-success-line bg-success-soft p-3 font-semibold text-success">This preview is eligible for explicit confirmation.</p>
            : <p className="state-indicator rounded-md border border-warning-line bg-warning-soft p-3 font-semibold text-warning">This preview is not eligible. Maximum safe debit: <CreditAmount value={workflow.preview.maximumSafeDebit} compact />. Confirm is unavailable.</p>}
          {(workflow.phase === 'revalidating' || workflow.phase === 'submitting') &&
            <p role="status" aria-live="polite" className="font-semibold text-primary">{busyLabel}</p>}
        </div>}
      </Modal>
    </section>
  )
}
