import { useEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import {
  availableSubscriptionLifecycleActions,
  useSubscriptionLifecycle,
} from '../../hooks/useSubscriptionLifecycle'
import type {
  BillingSubscriptionItem,
  BillingSubscriptionLifecycleAction,
  BillingSubscriptionState,
} from '../../types/billing'
import { Modal } from '../shared/Modal'

interface SubscriptionLifecycleControlsProps {
  clientId: string
  state: BillingSubscriptionState
  preflight: () => Promise<BillingSubscriptionState | null>
  uuidFactory?: () => string
  onPermissionDenied?: (error: ApiError) => void
}

interface SubscriptionLifecycleControlsViewProps {
  clientId: string
  state: BillingSubscriptionState
  preflight: () => Promise<BillingSubscriptionState | null>
  lifecycle: ReturnType<typeof useSubscriptionLifecycle>
}

const ACTION_LABEL: Record<BillingSubscriptionLifecycleAction, string> = {
  pause: 'Pause', reactivate: 'Reactivate', cancel: 'Cancel', expire: 'Expire',
}

const TARGET_STATUS: Record<BillingSubscriptionLifecycleAction, string> = {
  pause: 'paused', reactivate: 'active', cancel: 'cancelled', expire: 'expired',
}

function reasonError(reason: string): string | null {
  if (!reason) return 'Enter a reason for this lifecycle operation.'
  if (/^\p{White_Space}|\p{White_Space}$/u.test(reason)) {
    return 'The reason cannot begin or end with whitespace.'
  }
  let scalars = 0
  for (const scalar of reason) {
    const point = scalar.codePointAt(0)!
    if ((point >= 0xd800 && point <= 0xdfff) || /\p{Cc}/u.test(scalar)) {
      return 'The reason cannot contain control characters or invalid Unicode.'
    }
    scalars += 1
  }
  return scalars > 512 ? 'The reason must contain no more than 512 Unicode characters.' : null
}

function consequence(action: BillingSubscriptionLifecycleAction): string {
  if (action === 'pause') return 'Future cycle grants stop while paused. Paused boundaries are not backfilled.'
  if (action === 'reactivate') return 'No credits are granted now. Grants resume only at the next eligible active boundary.'
  if (action === 'cancel') return 'Cancellation is terminal and permanently stops future grants for this subscription.'
  return 'Expiry is terminal, permanently stops future grants, and records the finite validity boundary as the effective time.'
}

function resultCopy(error: ApiError | Error | null): { title: string; detail: string } {
  const status = error && 'status' in error ? (error as ApiError).status : undefined
  const code = error && 'code' in error ? (error as ApiError).code : undefined
  if (status === 400) return { title: 'Invalid lifecycle request', detail: 'Review the exact reason and confirm a new logical operation.' }
  if (status === 404) return { title: 'Subscription not found', detail: 'The server did not disclose whether the Client, subscription, or ownership mapping was missing.' }
  if (status === 413) return { title: 'Lifecycle request too large', detail: 'The closed request exceeded the server limit.' }
  if (status === 415) return { title: 'Lifecycle media type rejected', detail: 'The server requires the closed JSON request media type.' }
  if (code === 'subscription_lifecycle_operation_conflict') return { title: 'Operation identity conflict', detail: 'This operation ID is bound to different material. It cannot be replayed.' }
  if (code === 'subscription_lifecycle_state_conflict') return { title: 'Subscription state changed', detail: 'The expected status was stale. Review the refreshed authoritative state.' }
  if (code === 'subscription_lifecycle_transition_invalid') return { title: 'Lifecycle transition unavailable', detail: 'The source state is terminal or does not allow this transition.' }
  if (code === 'subscription_expiration_not_due') return { title: 'Subscription expiration is not due', detail: 'The database clock says the finite validity boundary has not been reached.' }
  if (code === 'subscription_validity_ended') return { title: 'Subscription validity ended', detail: 'Pause or Reactivate is no longer valid. Review the refreshed available actions.' }
  return { title: 'Lifecycle operation rejected', detail: 'The server rejected this operation. No transition has been inferred.' }
}

function ConfirmationContent({
  action, current, clientId, reason, setReason, validationError, validationSummaryRef, onConfirm,
}: {
  action: BillingSubscriptionLifecycleAction
  current: BillingSubscriptionItem
  clientId: string
  reason: string
  setReason: (value: string) => void
  validationError: string | null
  validationSummaryRef: React.RefObject<HTMLDivElement | null>
  onConfirm: () => void
}) {
  const errorId = 'lifecycle-reason-error'
  return (
    <form onSubmit={(event) => { event.preventDefault(); onConfirm() }} className="min-w-0 space-y-4">
      {validationError && (
        <div id="lifecycle-validation-summary" ref={validationSummaryRef} role="alert" tabIndex={-1} className="rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger outline-none focus-visible:ring-2 focus-visible:ring-danger">
          <a href="#lifecycle-reason" className="font-semibold underline">{validationError}</a>
        </div>
      )}
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium text-muted">Client</dt><dd className="break-all font-mono">{clientId}</dd></div>
        <div><dt className="font-medium text-muted">Subscription</dt><dd className="break-all font-mono">{current.subscriptionId}</dd></div>
        <div><dt className="font-medium text-muted">Plan</dt><dd className="break-words">{current.planName}</dd></div>
        <div><dt className="font-medium text-muted">Status change</dt><dd>{current.status} → {TARGET_STATUS[action]}</dd></div>
      </dl>
      <div className="rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">
        <p>{consequence(action)}</p>
        <p className="mt-2">Existing rollover credits and active reservations remain intact. This operation creates no grant, ledger entry, refund, or credit deletion.</p>
        <p className="mt-2">{action === 'expire'
          ? <>Effective time: the authoritative validity boundary <span className="break-all font-mono">{current.validTo}</span>. Server processing time is recorded separately.</>
          : 'Effective time: the server database operation time.'}</p>
      </div>
      <div>
        <label htmlFor="lifecycle-reason" className="block text-sm font-medium text-foreground">Reason</label>
        <textarea
          id="lifecycle-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={validationError ? 'true' : undefined}
          aria-describedby={validationError ? errorId : 'lifecycle-reason-help'}
          rows={4}
          className="mt-1 min-h-24 w-full min-w-0 rounded-md border border-control px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <p id="lifecycle-reason-help" className="mt-1 text-xs text-muted">Required: 1–512 Unicode characters; no leading/trailing whitespace or control characters. Text is preserved exactly.</p>
        {validationError && <p id={errorId} className="mt-1 text-sm text-danger">{validationError}</p>}
      </div>
      <button type="submit" className="min-h-11 w-full rounded-md bg-primary-solid px-4 py-2 font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2">
        Confirm {ACTION_LABEL[action]}
      </button>
    </form>
  )
}

export function SubscriptionLifecycleControls(props: SubscriptionLifecycleControlsProps) {
  const lifecycle = useSubscriptionLifecycle(props.clientId, {
    uuidFactory: props.uuidFactory,
    onPermissionDenied: props.onPermissionDenied,
  })
  return <SubscriptionLifecycleControlsView
    clientId={props.clientId}
    state={props.state}
    preflight={props.preflight}
    lifecycle={lifecycle}
  />
}

export function SubscriptionLifecycleControlsView({
  clientId, state, preflight, lifecycle,
}: SubscriptionLifecycleControlsViewProps) {
  const [selected, setSelected] = useState<BillingSubscriptionLifecycleAction | null>(null)
  const [selectedSnapshot, setSelectedSnapshot] = useState<BillingSubscriptionItem | null>(null)
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const safeDismissRef = useRef<HTMLButtonElement>(null)
  const validationSummaryRef = useRef<HTMLDivElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const refreshInFlightRef = useRef(false)
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'succeeded' | 'failed'>('idle')
  const actions = availableSubscriptionLifecycleActions(state)
  const current = state.current

  useEffect(() => {
    if (lifecycle.outcome === 'preflighting' || lifecycle.outcome === 'submitting' ||
        lifecycle.outcome === 'preflight-rejected') setSelected(null)
  }, [lifecycle.outcome])

  useEffect(() => {
    if (lifecycle.outcome !== 'idle' && lifecycle.outcome !== 'preflighting') {
      resultHeadingRef.current?.focus()
    }
  }, [lifecycle.outcome])

  useEffect(() => {
    if (!selectedSnapshot || !current) return
    if (selectedSnapshot.subscriptionId !== current.subscriptionId ||
        selectedSnapshot.status !== current.status || selectedSnapshot.validTo !== current.validTo) {
      setSelected(null)
    }
  }, [current, selectedSnapshot])

  useEffect(() => {
    const clearSensitiveConfirmation = (event: Event) => {
      if (event.type === 'auth:refreshed' && lifecycle.isOwnAuthReplayRefresh()) return
      setSelected(null)
      setSelectedSnapshot(null)
      setReason('')
      setValidationError(null)
    }
    window.addEventListener('auth:cleared', clearSensitiveConfirmation)
    window.addEventListener('auth:refreshed', clearSensitiveConfirmation)
    return () => {
      window.removeEventListener('auth:cleared', clearSensitiveConfirmation)
      window.removeEventListener('auth:refreshed', clearSensitiveConfirmation)
    }
  }, [lifecycle.isOwnAuthReplayRefresh])

  const dismissConfirmation = () => {
    setSelected(null)
    setSelectedSnapshot(null)
    setReason('')
    setValidationError(null)
  }

  const open = (action: BillingSubscriptionLifecycleAction) => {
    if (!current || lifecycle.outcome !== 'idle') return
    setSelectedSnapshot(current)
    setSelected(action)
    setValidationError(null)
  }

  const confirm = async () => {
    if (!selected || !selectedSnapshot) return
    const invalid = reasonError(reason)
    setValidationError(invalid)
    if (invalid) {
      requestAnimationFrame(() => validationSummaryRef.current?.focus())
      return
    }
    await lifecycle.confirm(selected, reason, selectedSnapshot, preflight)
  }

  const refreshLifecycleState = async () => {
    if (refreshInFlightRef.current || lifecycle.outcome !== 'idle') return
    refreshInFlightRef.current = true
    setRefreshState('checking')
    try {
      const fresh = await preflight()
      setRefreshState(fresh ? 'succeeded' : 'failed')
    } catch {
      setRefreshState('failed')
    } finally {
      refreshInFlightRef.current = false
    }
  }

  const clearCompleted = () => {
    setReason('')
    setValidationError(null)
    lifecycle.clear()
  }

  if (!current && lifecycle.outcome === 'idle') return null

  return (
    <section aria-labelledby="lifecycle-heading" className="min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-6">
      <h2 id="lifecycle-heading" className="text-lg font-semibold text-foreground">Subscription lifecycle</h2>
      {lifecycle.outcome === 'idle' && current && (
        <>
          <p className="mt-2 text-sm text-foreground">Actions use authoritative state as of <span className="break-all font-mono">{state.stateAsOf}</span>. The server database clock remains final.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {actions.map((action) => (
              <button key={action} type="button" onClick={() => open(action)} aria-label={`${ACTION_LABEL[action]} subscription`} className="min-h-11 min-w-11 rounded-md border border-control bg-surface px-4 py-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {ACTION_LABEL[action]}
              </button>
            ))}
            <button type="button" onClick={() => { void refreshLifecycleState() }} disabled={refreshState === 'checking'} className="min-h-11 min-w-11 rounded-md border border-control bg-surface px-4 py-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-60">{refreshState === 'checking' ? 'Refreshing lifecycle state…' : 'Refresh lifecycle state'}</button>
          </div>
          {refreshState !== 'idle' && <p role={refreshState === 'failed' ? 'alert' : 'status'} className={`state-indicator mt-3 text-sm ${refreshState === 'failed' ? 'text-danger' : 'text-foreground'}`}>{refreshState === 'checking' ? 'Refreshing authoritative lifecycle state…' : refreshState === 'succeeded' ? 'Authoritative lifecycle state refreshed.' : 'Authoritative lifecycle state could not be refreshed.'}</p>}
        </>
      )}

      {(lifecycle.outcome === 'preflighting' || lifecycle.outcome === 'submitting') && (
        <div className="mt-3"><h3 ref={resultHeadingRef} tabIndex={-1} className="font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus">{lifecycle.outcome === 'preflighting' ? 'Checking authoritative state' : 'Applying lifecycle operation'}</h3><p role="status" className="state-indicator mt-1 text-sm text-foreground">{lifecycle.outcome === 'preflighting' ? 'Confirmation is being revalidated…' : 'Submitting the retained operation once…'}</p></div>
      )}

      {lifecycle.outcome === 'preflight-rejected' && (
        <div className="mt-3 rounded-md border border-warning-line bg-warning-soft p-3"><h3 ref={resultHeadingRef} tabIndex={-1} className="font-semibold text-warning outline-none focus-visible:ring-2 focus-visible:ring-focus">Confirmation expired</h3><p role="alert" className="state-indicator mt-1 text-sm text-warning">Authoritative Client, subscription, status, validity, permission, or availability changed. Nothing was sent.</p><button type="button" onClick={lifecycle.clear} className="mt-3 min-h-11 rounded-md border border-warning-line bg-surface px-4 py-2 text-sm font-semibold text-warning">Return to refreshed actions</button></div>
      )}

      {lifecycle.outcome === 'completed' && lifecycle.receipt && (
        <div className="mt-3 rounded-md border border-success-line bg-success-soft p-3"><h3 ref={resultHeadingRef} tabIndex={-1} className="font-semibold text-success outline-none focus-visible:ring-2 focus-visible:ring-focus">Lifecycle operation completed</h3><p role="status" className="state-indicator mt-1 text-sm text-success">The immutable receipt was accepted. It does not distinguish first application from exact replay.</p><p className="mt-2 break-all text-sm text-success">Latest authoritative state as of <span className="font-mono">{state.stateAsOf}</span>.</p><dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2"><div><dt className="font-medium">Operation ID</dt><dd className="break-all font-mono">{lifecycle.receipt.lifecycleOperationId}</dd></div><div><dt className="font-medium">Status change</dt><dd>{lifecycle.receipt.previousStatus} → {lifecycle.receipt.status}</dd></div><div><dt className="font-medium">Effective at</dt><dd className="break-all">{lifecycle.receipt.effectiveAt}</dd></div><div><dt className="font-medium">Processed at</dt><dd className="break-all">{lifecycle.receipt.operationAsOf}</dd></div><div className="sm:col-span-2"><dt className="font-medium">Exact reason</dt><dd className="break-words">{lifecycle.receipt.reason}</dd></div></dl>{lifecycle.stateRefreshPending && <p role="status" className="state-indicator mt-3 text-sm text-warning">Refreshing authoritative subscription state. Older state is stale and is not the operation result.</p>}{lifecycle.stateRefreshFailed && <><p role="alert" className="mt-3 text-sm text-warning">The receipt is valid, but refreshed subscription state is unavailable. Older state must not be treated as the result.</p><button type="button" onClick={() => { void lifecycle.retryStateRefresh() }} className="mt-3 min-h-11 rounded-md border border-warning-line bg-surface px-4 py-2 text-sm font-semibold text-warning">Retry authoritative refresh</button></>}{!lifecycle.stateRefreshPending && !lifecycle.stateRefreshFailed && <button type="button" onClick={clearCompleted} className="mt-3 min-h-11 rounded-md border border-success-line bg-surface px-4 py-2 text-sm font-semibold text-success">Continue with authoritative state</button>}</div>
      )}

      {lifecycle.outcome === 'rejected' && (
        <div className="mt-3 rounded-md border border-danger-line bg-danger-soft p-3"><h3 ref={resultHeadingRef} tabIndex={-1} className="font-semibold text-danger outline-none focus-visible:ring-2 focus-visible:ring-focus">{resultCopy(lifecycle.error).title}</h3><p role="alert" className="state-indicator mt-1 text-sm text-danger">{resultCopy(lifecycle.error).detail}</p><p className="mt-2 text-sm text-danger">The exact reason remains available for review: <span className="break-words font-medium">{reason}</span></p><button type="button" onClick={() => { void lifecycle.abandon() }} className="mt-3 min-h-11 rounded-md border border-danger-line bg-surface px-4 py-2 text-sm font-semibold text-danger">Review refreshed state</button></div>
      )}

      {lifecycle.outcome === 'unknown' && (
        <div className="mt-3 rounded-md border border-warning-line bg-warning-soft p-3"><h3 ref={resultHeadingRef} tabIndex={-1} className="font-semibold text-warning outline-none focus-visible:ring-2 focus-visible:ring-focus">Lifecycle outcome unknown</h3><p role="alert" className="state-indicator mt-1 text-sm text-warning">The subscription may have changed. Authoritative GET state is context only and cannot prove this operation.</p><p className="mt-2 text-sm text-warning">{lifecycle.recovery === 'checking' ? 'Reconciling the Client-scoped subscription state…' : lifecycle.recovery === 'ready' ? 'Scope was reconciled. You may explicitly replay the exact retained route, body, reason, and operation ID.' : lifecycle.recovery === 'mismatch' ? 'The retained subscription is absent from current and terminal history. Exact replay remains blocked.' : 'Reconciliation is unavailable. Exact replay remains blocked.'}</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => { void lifecycle.retryExact() }} disabled={lifecycle.recovery !== 'ready'} className="min-h-11 rounded-md bg-primary-solid px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">Retry exact operation</button><button type="button" onClick={() => { void lifecycle.abandon() }} className="min-h-11 rounded-md border border-warning-line bg-surface px-4 py-2 text-sm font-semibold text-warning">Abandon unresolved attempt</button></div><p className="mt-2 text-xs text-warning">Abandon only if you accept that the first command may still have committed. A fresh GET is required before another action.</p></div>
      )}

      <Modal
        isOpen={Boolean(selected && selectedSnapshot)}
        onClose={dismissConfirmation}
        title={selected ? `Confirm ${ACTION_LABEL[selected]} subscription` : undefined}
        size="lg"
        closeLabel="Keep current status"
        initialFocusRef={safeDismissRef}
        footer={<button ref={safeDismissRef} type="button" data-modal-initial-focus onClick={dismissConfirmation} className="min-h-11 w-full rounded-md border border-control bg-surface px-4 py-2 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Keep current status</button>}
      >
        {selected && selectedSnapshot && <ConfirmationContent action={selected} current={selectedSnapshot} clientId={clientId} reason={reason} setReason={(value) => { setReason(value); setValidationError(null) }} validationError={validationError} validationSummaryRef={validationSummaryRef} onConfirm={() => { void confirm() }} />}
      </Modal>
    </section>
  )
}
