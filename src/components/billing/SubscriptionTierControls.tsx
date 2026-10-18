import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { useSubscriptionTierChange } from '../../hooks/useSubscriptionTierChange'
import type {
  BillingSubscriptionState,
  BillingSubscriptionTier,
  BillingSubscriptionTierAction,
} from '../../types/billing'
import { Modal } from '../shared/Modal'

const TARGETS: Array<{ value: BillingSubscriptionTier; label: string }> = [
  { value: 'basic', label: 'Basic' },
  { value: 'brand', label: 'Brand' },
  { value: 'brand_premium', label: 'Brand Premium' },
]

function statusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status : undefined
}

export function SubscriptionTierControls({
  clientId, state, preflight, onPermissionDenied, onAuthorityPending,
}: {
  clientId: string
  state: BillingSubscriptionState
  preflight: () => Promise<BillingSubscriptionState | null>
  onPermissionDenied?: (error: ApiError) => void
  onAuthorityPending?: (pending: boolean) => void
}) {
  const current = state.current
  const [target, setTarget] = useState<BillingSubscriptionTier>('basic')
  const [reason, setReason] = useState('Administrative tier change')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openGenerationRef = useRef(0)
  const preflightInFlightRef = useRef(false)
  const tier = useSubscriptionTierChange(
    clientId, current?.subscriptionId ?? 'invalid-subscription', { onPermissionDenied }
  )
  const authorityPending = Boolean(tier.result) &&
    (tier.phase === 'reconciling' || tier.phase === 'reconciliation_delayed')

  useLayoutEffect(() => {
    onAuthorityPending?.(authorityPending)
  }, [authorityPending, onAuthorityPending])

  useEffect(() => () => onAuthorityPending?.(false), [onAuthorityPending])

  const pending = state.pendingTierChange
  const availableTargets = TARGETS.filter((item) =>
    item.value !== current?.subscriptionTier && item.value !== pending?.subscriptionTier
  )
  const visibleTarget = availableTargets.some((item) => item.value === target)
    ? target : availableTargets[0]?.value

  useEffect(() => {
    if (visibleTarget && visibleTarget !== target) setTarget(visibleTarget)
  }, [target, visibleTarget])

  useEffect(() => {
    if (current) tier.discardIfAuthorityChanged(state)
  }, [current, state, tier.discardIfAuthorityChanged])

  useLayoutEffect(() => {
    openGenerationRef.current += 1
    preflightInFlightRef.current = false
    setPreflightBusy(false)
    setLocalError(null)
  }, [clientId, current?.subscriptionId])

  useEffect(() => {
    const resetPreflight = () => {
      openGenerationRef.current += 1
      preflightInFlightRef.current = false
      setPreflightBusy(false)
      setLocalError(null)
    }
    window.addEventListener('auth:cleared', resetPreflight)
    window.addEventListener('auth:refreshed', resetPreflight)
    return () => {
      window.removeEventListener('auth:cleared', resetPreflight)
      window.removeEventListener('auth:refreshed', resetPreflight)
    }
  }, [])

  if (!current || (current.status !== 'active' && current.status !== 'paused')) return null

  const validateReason = () => {
    const valid = reason.length >= 1 && reason.length <= 512 && reason.trim() === reason &&
      !/[\u0000-\u001f\u007f]/u.test(reason)
    setReasonError(valid ? null : 'Use 1–512 characters with no leading, trailing, or control characters.')
    if (!valid) queueMicrotask(() => summaryRef.current?.focus())
    return valid
  }

  const open = async (action: BillingSubscriptionTierAction) => {
    if (preflightInFlightRef.current || !validateReason()) return
    const openGeneration = ++openGenerationRef.current
    preflightInFlightRef.current = true
    setPreflightBusy(true)
    setLocalError(null)
    try {
      let fresh: BillingSubscriptionState | null
      try {
        fresh = await preflight()
      } catch (caught) {
        if (openGeneration !== openGenerationRef.current) return
        if (statusOf(caught) === 401 || statusOf(caught) === 403) {
          await tier.clearForPermissionLoss(caught as ApiError)
          return
        }
        if (statusOf(caught) === 404) {
          await tier.clearForNotFound()
          return
        }
        setLocalError('Fresh subscription evidence is required before confirmation.')
        return
      }
      if (openGeneration !== openGenerationRef.current) return
      if (!fresh?.current || fresh.clientId !== clientId || fresh.current.clientId !== clientId) {
        setLocalError('Fresh subscription evidence is required before confirmation.')
        return
      }
      const freshPending = fresh.pendingTierChange
      const selectedTier = action === 'cancel_pending'
        ? freshPending?.subscriptionTier : visibleTarget
      if (!selectedTier || fresh.current.subscriptionId !== current.subscriptionId ||
          fresh.current.tierRevision !== current.tierRevision ||
          (freshPending?.operationId ?? null) !== (pending?.operationId ?? null) ||
          ((action === 'apply_immediate' || action === 'schedule') && freshPending) ||
          ((action === 'replace' || action === 'cancel_pending') && !freshPending) ||
          (action === 'replace' && (selectedTier === fresh.current.subscriptionTier ||
            selectedTier === freshPending?.subscriptionTier))) {
        setLocalError('The available tier action changed. Refresh and choose again.')
        return
      }
      setPreflightBusy(false)
      await tier.prepare({
        action,
        subscriptionTier: selectedTier,
        expectedTierRevision: fresh.current.tierRevision,
        effectivePolicy: action === 'apply_immediate' ? 'immediate' : 'next_billing_cycle',
        ...(freshPending ? { expectedPendingTierChangeOperationId: freshPending.operationId } : {}),
        reason,
      }, fresh)
    } finally {
      if (openGeneration === openGenerationRef.current) {
        preflightInFlightRef.current = false
        setPreflightBusy(false)
      }
    }
  }

  const busy = preflightBusy || tier.phase === 'previewing' || tier.phase === 'revalidating' ||
    tier.phase === 'submitting' || tier.phase === 'reconciling'
  const commandLocked = preflightBusy || tier.phase !== 'idle'
  const refreshTransition = async () => {
    try {
      const fresh = await preflight()
      if (fresh?.clientId === clientId && fresh.current?.subscriptionId === current.subscriptionId &&
          (fresh.current.tierRevision !== current.tierRevision ||
            (fresh.pendingTierChange?.operationId ?? null) !== (pending?.operationId ?? null)))
        tier.clear()
    } catch (caught) {
      if (statusOf(caught) === 401 || statusOf(caught) === 403)
        await tier.clearForPermissionLoss(caught as ApiError)
      else if (statusOf(caught) === 404) await tier.clearForNotFound()
      else setLocalError('Fresh subscription evidence is required before confirmation.')
    }
  }
  return (
    <section aria-labelledby="tier-controls-heading" className="rounded-lg border border-info-line bg-surface p-4 sm:p-6">
      <h2 id="tier-controls-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">Subscription tier controls</h2>
      <p className="mt-1 text-sm text-foreground">Tier changes affect capability access only. Financial plan terms, credits, and accepted AI work are separate and unchanged.</p>
      {!authorityPending && <dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-3">
        <div><dt className="font-medium text-muted">Stored tier</dt><dd>{current.subscriptionTier}</dd></div>
        <div><dt className="font-medium text-muted">Tier revision</dt><dd className="font-mono">{current.tierRevision}</dd></div>
        <div><dt className="font-medium text-muted">Pending tier</dt><dd>{pending?.subscriptionTier ?? 'None'}</dd></div>
      </dl>}
      {authorityPending && <p role="status" className="state-indicator mt-3 text-sm font-medium text-info">Current tier authority is being reconciled; earlier tier values are hidden.</p>}
      {!authorityPending && pending && <p role="status" className="state-indicator mt-3 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">Pending {pending.subscriptionTier} at {pending.effectiveCycleStart}. Operation {pending.operationId}.</p>}
      {localError && <div ref={summaryRef} tabIndex={-1} role="alert" className="state-indicator mt-3 rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger outline-none">{localError}</div>}
      {reasonError && <div ref={summaryRef} tabIndex={-1} role="alert" className="state-indicator mt-3 rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger outline-none"><a href="#tier-reason" className="font-semibold underline">Tier change justification:</a> <span id="tier-reason-error">{reasonError}</span></div>}
      {!authorityPending && <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <div><label htmlFor="tier-target" className="block text-sm font-medium text-foreground">Target tier</label><select id="tier-target" value={visibleTarget ?? ''} onChange={(event) => setTarget(event.target.value as BillingSubscriptionTier)} disabled={commandLocked} className="mt-1 min-h-11 w-full rounded-md border border-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{availableTargets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div><label htmlFor="tier-reason" className="block text-sm font-medium text-foreground">Tier change justification</label><input id="tier-reason" value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(null) }} disabled={commandLocked} maxLength={512} aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? "tier-reason-error" : undefined} className="mt-1 min-h-11 w-full rounded-md border border-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" /></div>
      </div>}
      {!authorityPending && <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={commandLocked || Boolean(pending)} onClick={(event) => { returnFocusRef.current = event.currentTarget; void open('apply_immediate') }} className="min-h-11 max-w-full break-words rounded-md bg-info-solid px-4 py-2 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-60">Apply tier immediately</button>
        <button type="button" disabled={commandLocked || Boolean(pending)} onClick={(event) => { returnFocusRef.current = event.currentTarget; void open('schedule') }} className="min-h-11 max-w-full break-words rounded-md border border-info-line bg-surface px-4 py-2 text-sm font-semibold text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:opacity-60">Schedule for next cycle</button>
        {pending && <button type="button" disabled={commandLocked} onClick={(event) => { returnFocusRef.current = event.currentTarget; void open('replace') }} className="min-h-11 max-w-full break-words rounded-md border border-info-line bg-surface px-4 py-2 text-sm font-semibold text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">Replace pending tier</button>}
        {pending && <button type="button" disabled={commandLocked} onClick={(event) => { returnFocusRef.current = event.currentTarget; void open('cancel_pending') }} className="min-h-11 max-w-full break-words rounded-md border border-danger-line bg-surface px-4 py-2 text-sm font-semibold text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">Cancel pending tier</button>}
      </div>}
      {preflightBusy && <p role="status" className="state-indicator mt-3 text-sm font-medium text-info">Checking fresh subscription authority before preview…</p>}
      {busy && !preflightBusy && <p role="status" className="state-indicator mt-3 text-sm font-medium text-info">{tier.phase === 'previewing' ? 'Preparing authoritative consequence preview…' : tier.phase === 'revalidating' ? 'Checking fresh subscription and preview authority before submit…' : tier.phase === 'submitting' ? 'Submitting the retained command…' : 'Reconciling authoritative subscription and consequence state…'}</p>}
      {tier.phase === 'unknown' && <div role="alert" className="state-indicator mt-3 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning"><p>The command outcome is unknown. Its exact operation identity, route, and bytes are retained.</p><button type="button" onClick={() => void tier.retry()} className="mt-2 min-h-11 rounded-md bg-info-solid px-4 py-2 font-semibold text-on-accent">Replay exact retained command</button></div>}
      {tier.phase === 'transition_pending' && <div role="alert" className="state-indicator mt-3 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning"><p>A due tier transition is materializing. Competing commands remain unavailable; automatic reconciliation is bounded.</p><button type="button" onClick={() => void refreshTransition()} className="mt-2 min-h-11 font-semibold underline">Refresh authority</button></div>}
      {tier.phase === 'rejected' && <div role="alert" className="state-indicator mt-3 rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger"><p>{statusOf(tier.error) === 404 ? 'The subscription was not found.' : 'The tier action was rejected. Fresh authority and a new confirmation are required.'}</p><button type="button" onClick={tier.clear} className="mt-2 min-h-11 font-semibold underline">Dismiss and start a fresh preview</button></div>}
      {tier.result && <section aria-labelledby="tier-result-heading" className="mt-4 rounded-md border border-success-line bg-success-soft p-3"><h3 id="tier-result-heading" className="font-semibold text-success">Tier command receipt</h3><p role="status" className="state-indicator mt-1 text-sm text-success">{tier.result.receipt.outcome}. Operation {tier.result.receipt.operationId}. Effective {tier.result.receipt.effectiveAt}. {tier.phase === 'succeeded' ? 'Authoritative state reconciled.' : tier.phase === 'reconciliation_delayed' ? 'The receipt is valid, but authoritative reconciliation is delayed.' : 'Authoritative reconciliation in progress.'}</p>{tier.phase === 'reconciliation_delayed' && <button type="button" onClick={() => void tier.reconcile()} className="mt-2 min-h-11 font-semibold text-success underline">Retry authoritative reconciliation</button>}{tier.phase === 'succeeded' && <button type="button" onClick={tier.clear} className="mt-2 min-h-11 font-semibold text-success underline">Close receipt</button>}</section>}

      <Modal isOpen={(tier.phase === 'confirmable' || tier.phase === 'revalidating') && Boolean(tier.confirmation)} onClose={tier.clear} returnFocusRef={returnFocusRef} title={tier.confirmation?.material.action === 'cancel_pending' ? 'Confirm pending tier cancellation' : 'Confirm subscription tier change'} size="lg" closeDisabled={busy} footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" data-modal-initial-focus disabled={busy} onClick={tier.clear} className="min-h-11 rounded-md border border-control bg-surface px-4 py-2 font-semibold">Cancel</button><button type="button" disabled={busy || Boolean(tier.confirmation?.preview.unlistedNewlyAffectedCount && tier.confirmation.material.action !== 'cancel_pending')} onClick={() => { returnFocusRef.current = headingRef.current; void tier.confirm(preflight) }} className="min-h-11 rounded-md bg-info-solid px-4 py-2 font-semibold text-on-accent">{tier.confirmation?.material.action === 'cancel_pending' ? 'Confirm cancellation' : 'Confirm tier change'}</button></div>}>
        {tier.phase === 'revalidating' && <p role="status" className="mb-3 text-sm font-medium text-info">Checking fresh subscription and preview authority before submit…</p>}
        {tier.confirmation && <TierConfirmationContent confirmation={tier.confirmation} clientId={clientId} />}
      </Modal>
    </section>
  )
}

function TierConfirmationContent({ confirmation, clientId }: {
  confirmation: NonNullable<ReturnType<typeof useSubscriptionTierChange>['confirmation']>
  clientId: string
}) {
  const { material, preview } = confirmation
  const cancelling = material.action === 'cancel_pending'
  return (
    <div className="min-w-0 text-sm text-foreground">
      <p>Client <span className="break-all font-mono">{clientId}</span>.{' '}
        {cancelling
          ? `Cancel the pending ${material.subscriptionTier} tier change. The stored ${preview.currentSubscriptionTier} tier remains in effect.`
          : `Change ${preview.currentSubscriptionTier} to ${material.subscriptionTier} (${material.effectivePolicy}).`}
      </p>
      {preview.deadlineGroupsTruncated && <p role="alert" className="mt-3 rounded-md border border-warning-line bg-warning-soft p-3 text-warning">
        {preview.unlistedGraceCount} affected {preview.unlistedGraceCount === 1 ? 'resource' : 'resources'} in grace{' '}
        {preview.unlistedGraceCount === 1 ? 'has' : 'have'} additional deadlines beyond this bounded preview.
        {!cancelling && preview.unlistedNewlyAffectedCount > 0 &&
          ` ${preview.unlistedNewlyAffectedCount} newly affected ${preview.unlistedNewlyAffectedCount === 1 ? 'resource is' : 'resources are'} among them; confirmation is unavailable until their deadlines can be reviewed.`}
      </p>}
      {cancelling ? (
        <p className="mt-4 font-medium">
          The pending tier change will be cancelled. The server preview reports {preview.retainedCount} of{' '}
          {preview.totalCount} resources retained, {preview.graceCount} in grace, and{' '}
          {preview.suspendedCount} suspended. Content and assets will not be deleted.
          Credits and accepted AI work are unchanged.
        </p>
      ) : preview.deadlineGroups.length === 1 &&
          preview.deadlineGroups[0].newlyAffectedCount === preview.graceCount ? (
        <p className="mt-4 font-medium">
          At {preview.lossAt}, new paid work will stop. {preview.retainedCount} of{' '}
          {preview.totalCount} resources will remain active. The policy grace deadline for{' '}
          {preview.graceCount} affected {preview.graceCount === 1 ? 'resource' : 'resources'} is{' '}
          {preview.accessUntil}. They may remain available
          until then if ownership, TLS, and routing evidence stays current; they will be suspended
          at that deadline if still over limit.
          Content and assets will not be deleted. Credits and accepted AI work are unchanged.
        </p>
      ) : preview.deadlineGroups.length > 0 ? (
        <div className="mt-4 font-medium">
          <p>{preview.retainedCount} of {preview.totalCount} resources remain active. Policy grace deadlines:</p>
          <ul className="mt-2 list-disc pl-5">
            {preview.deadlineGroups.map((group) => <li key={`${group.lossAt}:${group.accessUntil}`}>
              The policy grace deadline for {group.graceCount} affected{' '}
              {group.graceCount === 1 ? 'resource' : 'resources'} is{' '}
              {group.accessUntil}. They may remain available until then if ownership, TLS, and
              routing evidence stays current; they will be suspended at that deadline if still
              over limit.{' '}
              {group.newlyAffectedCount > 0 && <span>{group.newlyAffectedCount} newly affected{' '}
                {group.newlyAffectedCount === 1 ? 'resource stops' : 'resources stop'} new paid work at{' '}
                {group.lossAt}. </span>}
              {group.graceCount > group.newlyAffectedCount && <span>
                {group.graceCount - group.newlyAffectedCount} already in grace. </span>}
            </li>)}
          </ul>
          <p>Content and assets will not be deleted. Credits and accepted AI work are unchanged.</p>
        </div>
      ) : (
        <p className="mt-4 font-medium">
          The server reports no timed access loss for this action. {preview.retainedCount} of{' '}
          {preview.totalCount} resources remain active; {preview.suspendedCount} are suspended.
          Content and assets will not be deleted. Credits and accepted AI work are unchanged.
        </p>
      )}
      {preview.earliestProofExpiry && <p className="mt-3 break-words rounded-md border border-warning-line bg-warning-soft p-3 text-warning">
        The earliest known ownership or TLS proof expiry for an affected domain binding is{' '}
        {preview.earliestProofExpiry}. That binding may stop serving then unless its proof is
        renewed. This does not change the policy grace deadline.
      </p>}
      <dl className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
        <div><dt className="font-medium text-muted">Tier revision</dt><dd className="font-mono">{preview.tierRevision}</dd></div>
        <div><dt className="font-medium text-muted">Policy version</dt><dd>{preview.policyVersion}</dd></div>
        <div><dt className="font-medium text-muted">Classification revision</dt><dd className="font-mono">{preview.classificationRevision}</dd></div>
        <div><dt className="font-medium text-muted">Pending operation</dt><dd className="break-all font-mono">{preview.pendingTierChangeOperationId ?? 'None'}</dd></div>
      </dl>
    </div>
  )
}
