import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import {
  type PlanChangeFreshState,
  useSubscriptionPlanChange,
} from '../../hooks/useSubscriptionPlanChange'
import type {
  BillingAccountSnapshot,
  BillingSubscriptionPlanChangeAction,
  BillingSubscriptionPlanChangePreviewRequest,
  BillingSubscriptionProrationPolicy,
  BillingSubscriptionState,
} from '../../types/billing'
import { Modal } from '../shared/Modal'

const statusOf = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status : undefined

export function SubscriptionPlanChangeControls({
  clientId, state, account, preflight, onPermissionDenied, onAuthorityPending,
}: {
  clientId: string
  state: BillingSubscriptionState
  account: BillingAccountSnapshot | null
  preflight: () => Promise<PlanChangeFreshState | null>
  onPermissionDenied?: (error: ApiError) => void
  onAuthorityPending?: (pending: boolean) => void
}) {
  const current = state.current
  const [action, setAction] = useState<BillingSubscriptionPlanChangeAction | ''>('')
  const [planName, setPlanName] = useState(current?.planName ?? '')
  const [cycleCreditAmount, setCycleCreditAmount] = useState(current?.cycleCreditAmount ?? '')
  const [requestsPerMinute, setRequestsPerMinute] = useState(
    String(current?.entitlements.rateLimits.requestsPerMinute ?? 1))
  const [concurrentAiOperations, setConcurrentAiOperations] = useState(
    String(current?.entitlements.rateLimits.concurrentAiOperations ?? 1))
  const [contentGeneration, setContentGeneration] = useState(
    current?.entitlements.featureFlags.contentGeneration ?? false)
  const [imageGeneration, setImageGeneration] = useState(
    current?.entitlements.featureFlags.imageGeneration ?? false)
  const [prorationPolicy, setProrationPolicy] = useState<BillingSubscriptionProrationPolicy>(
    current?.prorationPolicy ?? 'prorate')
  const [reason, setReason] = useState('Administrative financial plan change')
  const [formError, setFormError] = useState<string | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [showAbandonWarning, setShowAbandonWarning] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openGenerationRef = useRef(0)
  const openInFlightRef = useRef(false)
  const plan = useSubscriptionPlanChange(
    clientId, current?.subscriptionId ?? 'invalid-subscription', { onPermissionDenied })
  const authorityPending = Boolean(plan.result) &&
    (plan.phase === 'reconciling' || plan.phase === 'reconciliation_delayed')

  useLayoutEffect(() => { onAuthorityPending?.(authorityPending) }, [authorityPending, onAuthorityPending])
  useEffect(() => () => onAuthorityPending?.(false), [onAuthorityPending])
  useLayoutEffect(() => {
    openGenerationRef.current += 1
    openInFlightRef.current = false
    setAction('')
    setFormError(null)
    setShowAbandonWarning(false)
  }, [clientId, current?.subscriptionId])

  useEffect(() => {
    if (!current) return
    plan.discardIfAuthorityChanged({ subscription: state, account })
  }, [account, current, plan.discardIfAuthorityChanged, state])

  if (!current || (current.status !== 'active' && current.status !== 'paused')) return null
  const pending = state.pendingChange
  const unsupportedPending = Boolean(pending && 'status' in pending)
  const supportedPending = pending && !('status' in pending) ? pending : null
  const remainder = state.pendingImmediateDebit ?? current.pendingImmediateDebit
  const unsupportedRemainder = Boolean(remainder && 'status' in remainder)
  const supportedRemainder = remainder && !('status' in remainder) ? remainder : null
  const choices: Array<{ value: BillingSubscriptionPlanChangeAction; label: string }> = [
    ...(!remainder && !unsupportedPending
      ? [{ value: 'apply_immediate' as const, label: 'Apply financial terms immediately' }] : []),
    ...(current.status === 'active' && !pending
      ? [{ value: 'schedule' as const, label: 'Schedule terms for next billing cycle' }] : []),
    ...(current.status === 'active' && supportedPending
      ? [
          { value: 'replace' as const, label: 'Replace pending financial terms' },
          { value: 'cancel' as const, label: 'Cancel pending financial terms' },
        ] : []),
  ]
  const selectedAction = choices.some((choice) => choice.value === action) ? action : ''
  const locked = preflightBusy || plan.phase !== 'idle'

  const validate = (): BillingSubscriptionPlanChangePreviewRequest | null => {
    if (!selectedAction) { setFormError('Choose a financial action.'); return null }
    if (reason !== reason.trim() || [...reason].length < 1 || [...reason].length > 512 ||
        /[\u0000-\u001f\u007f]/u.test(reason)) {
      setFormError('Justification must contain 1–512 characters with no leading, trailing, or control characters.')
      return null
    }
    if (selectedAction === 'cancel') return { action: 'cancel' }
    const rpm = Number(requestsPerMinute)
    const concurrent = Number(concurrentAiOperations)
    const creditAmountIsPositive = /^(?:0\.\d{1,4}|[1-9]\d{0,13}(?:\.\d{1,4})?)$/.test(cycleCreditAmount) &&
      !/^0\.0{1,4}$/.test(cycleCreditAmount)
    if (planName !== planName.trim() || planName.length < 1 || planName.length > 128 ||
        !creditAmountIsPositive ||
        !Number.isInteger(rpm) || rpm < 1 || rpm > 10_000 ||
        !Number.isInteger(concurrent) || concurrent < 1 || concurrent > 1_000 ||
        (!contentGeneration && !imageGeneration)) {
      setFormError('Review the linked plan name, exact credit amount, and positive entitlement limits.')
      return null
    }
    return { action: selectedAction, planName, cycleCreditAmount,
      entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: rpm,
        concurrentAiOperations: concurrent }, featureFlags: { contentGeneration, imageGeneration } },
      prorationPolicy, unusedCreditPolicy: 'rollover' }
  }

  const open = async (button: HTMLElement) => {
    if (openInFlightRef.current) return
    const request = validate()
    if (!request) { queueMicrotask(() => summaryRef.current?.focus()); return }
    returnFocusRef.current = button
    const generation = ++openGenerationRef.current
    openInFlightRef.current = true
    setPreflightBusy(true)
    setFormError(null)
    try {
      const fresh = await preflight()
      if (generation !== openGenerationRef.current) return
      if (!fresh?.subscription.current || fresh.subscription.clientId !== clientId ||
          fresh.subscription.current.subscriptionId !== current.subscriptionId) {
        setFormError('Fresh subscription and account evidence is required before preview.')
        return
      }
      const freshPending = fresh.subscription.pendingChange
      const freshPendingId = freshPending && !('status' in freshPending)
        ? freshPending.planChangeOperationId : null
      if (fresh.subscription.current.planTermsOperationId !== current.planTermsOperationId ||
          fresh.subscription.current.updatedAt !== current.updatedAt ||
          freshPendingId !== (supportedPending?.planChangeOperationId ?? null) ||
          Boolean(freshPending && 'status' in freshPending) !== unsupportedPending) {
        setFormError('Financial authority changed. Review the refreshed subscription before continuing.')
        return
      }
      await plan.prepare({ request, reason }, fresh)
    } catch (caught) {
      const status = statusOf(caught)
      if (status === 401 || status === 403) await plan.clearForPermissionLoss(caught as ApiError)
      else if (status === 404) await plan.clearForNotFound()
      else setFormError('Fresh subscription and account evidence is required before preview.')
    } finally {
      if (generation === openGenerationRef.current) {
        openInFlightRef.current = false
        setPreflightBusy(false)
      }
    }
  }

  const abandon = async () => {
    const abandoned = await plan.abandon(preflight)
    if (abandoned) setShowAbandonWarning(false)
    else setFormError('Fresh authority could not be loaded; the retained operation remains available.')
  }

  const busy = preflightBusy || ['previewing', 'revalidating', 'submitting', 'reconciling']
    .includes(plan.phase)
  return (
    <section aria-labelledby="financial-plan-controls-heading" className="min-w-0 rounded-lg border border-sky-200 bg-white p-4 sm:p-6">
      <h2 id="financial-plan-controls-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-gray-950 outline-none">Financial plan controls</h2>
      <p className="mt-1 text-sm text-gray-700">Financial terms and credits are independent from subscription tier and Client classification. Subscription validity and its optional end remain unchanged.</p>

      {unsupportedPending && <p role="alert" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The pending financial change uses an unsupported schema. It is read-only; financial mutation is unavailable.</p>}
      {supportedPending && <div role="status" className="state-indicator mt-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"><p className="font-semibold">Pending financial change</p><p>{supportedPending.planName} with {supportedPending.cycleCreditAmount} cycle credits, effective cycle {supportedPending.effectiveCycleIndex} ({supportedPending.effectiveCycleStart} to {supportedPending.effectiveCycleEnd}). Operation <span className="break-all font-mono">{supportedPending.planChangeOperationId}</span>.</p></div>}
      {unsupportedRemainder && <p role="alert" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Immediate-debit state uses an unsupported schema. Immediate financial change is unavailable.</p>}
      {supportedRemainder && <div role="status" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Outstanding immediate debit</p><p>{supportedRemainder.outstandingDebit} credits remain from operation <span className="break-all font-mono">{supportedRemainder.planChangeOperationId}</span>. Renewal settlement remains authoritative; another immediate change is unavailable.</p></div>}
      {formError && <div ref={summaryRef} tabIndex={-1} role="alert" className="state-indicator mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 outline-none"><a href={selectedAction === 'cancel' ? '#financial-reason' : '#financial-plan-name'} className="font-semibold underline">Review financial plan fields:</a> {formError}</div>}

      {!authorityPending && !unsupportedPending && <div className="mt-4 min-w-0 space-y-4">
        <fieldset disabled={locked} className="min-w-0"><legend className="text-sm font-semibold text-gray-900">Choose one financial action</legend><div className="mt-2 grid min-w-0 gap-2">{choices.map((choice) => <label key={choice.value} className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-gray-300 px-3 py-2"><input className="shrink-0" type="radio" name="financial-action" value={choice.value} checked={selectedAction === choice.value} onChange={() => { setAction(choice.value); setFormError(null) }} /> <span className="min-w-0 break-words">{choice.label}</span></label>)}</div></fieldset>
        {selectedAction && selectedAction !== 'cancel' && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id="financial-plan-name" label="Plan name"><input id="financial-plan-name" value={planName} onChange={(e) => setPlanName(e.target.value)} disabled={locked} maxLength={128} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" /></Field>
          <Field id="financial-cycle-credits" label="Cycle credit amount (exact credits, not currency)"><input id="financial-cycle-credits" inputMode="decimal" value={cycleCreditAmount} onChange={(e) => setCycleCreditAmount(e.target.value)} disabled={locked} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" /></Field>
          <Field id="financial-rpm" label="Requests per minute"><input id="financial-rpm" inputMode="numeric" value={requestsPerMinute} onChange={(e) => setRequestsPerMinute(e.target.value)} disabled={locked} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" /></Field>
          <Field id="financial-concurrency" label="Concurrent AI operations"><input id="financial-concurrency" inputMode="numeric" value={concurrentAiOperations} onChange={(e) => setConcurrentAiOperations(e.target.value)} disabled={locked} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" /></Field>
          <Field id="financial-proration" label="Proration policy"><select id="financial-proration" value={prorationPolicy} onChange={(e) => setProrationPolicy(e.target.value as BillingSubscriptionProrationPolicy)} disabled={locked} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700"><option value="none">None</option><option value="replace">Replace</option><option value="prorate">Prorate</option></select></Field>
          <div><span className="block text-sm font-medium text-gray-800">Feature entitlements</span><label className="mt-1 flex min-h-11 items-center gap-2"><input type="checkbox" checked={contentGeneration} onChange={(e) => setContentGeneration(e.target.checked)} disabled={locked} /> Content generation</label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={imageGeneration} onChange={(e) => setImageGeneration(e.target.checked)} disabled={locked} /> Image generation</label></div>
        </div>}
        {selectedAction && <Field id="financial-reason" label="Financial change justification"><input id="financial-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={locked} maxLength={512} className="mt-1 min-h-11 min-w-0 max-w-full w-full rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" /></Field>}
        <p className="text-sm text-gray-700">Unused credits remain on the fixed rollover policy. No subscription tier, classification, or validity field is sent.</p>
        <button type="button" disabled={locked || !selectedAction} onClick={(event) => void open(event.currentTarget)} className="min-h-11 max-w-full whitespace-normal break-words rounded-md bg-sky-800 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 disabled:opacity-60">Preview selected financial action</button>
      </div>}

      {busy && <p role="status" className="state-indicator mt-3 text-sm font-medium text-sky-950">{preflightBusy ? 'Checking fresh subscription and account authority…' : plan.phase === 'previewing' ? 'Preparing authoritative financial projection…' : plan.phase === 'revalidating' ? 'Revalidating authority before submit…' : plan.phase === 'submitting' ? 'Submitting the retained command once…' : 'Reconciling authoritative Client state…'}</p>}
      {plan.phase === 'rejected' && <div role="alert" className="state-indicator mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950"><p>{(plan.error as ApiError | null)?.code === 'subscription_plan_change_stale_preview' ? 'The reviewed authority became stale. Fresh reads and a new preview are required.' : statusOf(plan.error) === 409 ? 'The financial action conflicted with current state or eligibility. Fresh authority and a new preview are required.' : 'The financial action was rejected. No outcome has been inferred.'}</p><button type="button" onClick={plan.clear} className="mt-2 min-h-11 font-semibold underline">Dismiss and review fresh authority</button></div>}
      {plan.phase === 'unknown' && <div role="alert" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>The command outcome is unknown. The exact route, UUIDv7, and request bytes are retained. GET-only reconciliation completed before these recovery choices were enabled.</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => void plan.retry()} className="min-h-11 rounded-md bg-sky-800 px-4 py-2 font-semibold text-white">Replay exact retained command</button><button type="button" onClick={() => setShowAbandonWarning(true)} className="min-h-11 font-semibold underline">Consider abandoning retained retry</button></div>{showAbandonWarning && <div className="mt-3 rounded-md border border-red-300 p-3"><p>An earlier command may still have landed. Abandon only after reviewing fresh state; a later new operation could otherwise create another logical change.</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => void abandon()} className="min-h-11 font-semibold text-red-900 underline">Abandon after fresh reads</button><button type="button" onClick={() => setShowAbandonWarning(false)} className="min-h-11 font-semibold underline">Keep retained retry</button></div></div>}</div>}
      {plan.result && <section aria-labelledby="financial-receipt-heading" className="mt-4 rounded-md border border-gray-400 bg-gray-50 p-3"><h3 id="financial-receipt-heading" className="font-semibold text-gray-950">Immutable financial command receipt</h3><p role="status" className="state-indicator mt-1 text-sm text-gray-900">Operation <span className="break-all font-mono">{plan.result.planChangeOperationId}</span>; action {plan.result.action}; operation time {plan.result.operationAsOf}. {plan.phase === 'succeeded' ? 'Authoritative state reconciled.' : plan.phase === 'reconciliation_delayed' ? 'The receipt is valid; current state is unavailable or stale.' : 'Authoritative state reconciliation is in progress.'}</p>{plan.result.action === 'apply_immediate' && <p className="mt-2 text-sm">Final authoritative credit arithmetic: delta {plan.result.calculation.delta}, applied {plan.result.calculation.appliedDelta}, outstanding {plan.result.calculation.outstandingDelta}; wallet version {plan.result.account.walletVersionBefore} → {plan.result.account.walletVersionAfter}.</p>}{plan.phase === 'reconciliation_delayed' && <button type="button" onClick={() => void plan.reconcile()} className="mt-2 min-h-11 font-semibold underline">Retry authoritative reconciliation</button>}{plan.phase === 'succeeded' && <button type="button" onClick={plan.clear} className="mt-2 min-h-11 font-semibold underline">Close receipt</button>}</section>}

      <Modal isOpen={(plan.phase === 'confirmable' || plan.phase === 'revalidating') && Boolean(plan.confirmation)} onClose={plan.clear} returnFocusRef={returnFocusRef} title="Confirm financial plan change" size="lg" closeDisabled={busy} footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" data-modal-initial-focus disabled={busy} onClick={plan.clear} className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold">Cancel</button><button type="button" disabled={busy} onClick={() => { returnFocusRef.current = headingRef.current; void plan.confirm(preflight) }} className="min-h-11 rounded-md bg-sky-800 px-4 py-2 font-semibold text-white">Confirm financial change</button></div>}>
        {plan.phase === 'revalidating' && <p role="status" className="mb-3 text-sm font-medium text-sky-950">Revalidating subscription, account, and preview authority…</p>}
        {plan.confirmation && <FinancialPreview confirmation={plan.confirmation} />}
      </Modal>
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><label htmlFor={id} className="block break-words text-sm font-medium text-gray-800">{label}</label>{children}</div>
}

function FinancialPreview({ confirmation }: {
  confirmation: NonNullable<ReturnType<typeof useSubscriptionPlanChange>['confirmation']>
}) {
  const { material, preview } = confirmation
  const effect = preview.creditEffect
  return <div className="min-w-0 text-sm text-gray-800">
    <p>This is a server projection at {preview.previewedAt}. The immutable command receipt will contain final command-time arithmetic.</p>
    <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2"><div><dt className="font-medium">Action</dt><dd>{material.request.action}</dd></div><div><dt className="font-medium">Current plan</dt><dd>{preview.currentTerms.planName} · {preview.currentTerms.cycleCreditAmount} credits</dd></div><div><dt className="font-medium">Resulting plan</dt><dd>{preview.targetTerms ? `${preview.targetTerms.planName} · ${preview.targetTerms.cycleCreditAmount} credits` : preview.currentTerms.planName}</dd></div><div><dt className="font-medium">Pending result</dt><dd>{preview.pendingResult}</dd></div>{preview.effectiveCycle && <><div><dt className="font-medium">Effective cycle</dt><dd>{preview.effectiveCycle.cycleIndex}</dd></div><div><dt className="font-medium">Saved-zone boundary</dt><dd>{preview.effectiveCycle.cycleStart} to {preview.effectiveCycle.cycleEnd}</dd></div></>}</dl>
    {preview.targetTerms && <div className="mt-3"><p className="font-medium">Target entitlements</p><p>{preview.targetTerms.entitlements.rateLimits.requestsPerMinute} requests/minute; {preview.targetTerms.entitlements.rateLimits.concurrentAiOperations} concurrent AI operations; content generation {preview.targetTerms.entitlements.featureFlags.contentGeneration ? 'enabled' : 'disabled'}; image generation {preview.targetTerms.entitlements.featureFlags.imageGeneration ? 'enabled' : 'disabled'}.</p></div>}
    {effect.calculation && effect.account && <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 p-3"><p className="font-semibold">Immediate credit projection</p><p>Funding basis {effect.calculation.fundingBasis}; policy {effect.calculation.policyVersion}; current-cycle delta {effect.calculation.delta}; applied now {effect.calculation.appliedDelta}; outstanding {effect.calculation.outstandingDelta}. Balance {effect.account.balanceBefore} → {effect.account.balanceAfter}; reserved {effect.account.reservedBalanceBefore} → {effect.account.reservedBalanceAfter}; available {effect.account.availableBalanceBefore} → {effect.account.availableBalanceAfter}.</p>{effect.calculation.outstandingDelta.startsWith('-') && effect.calculation.outstandingDelta !== '0' && <p role="alert" className="mt-2 font-semibold text-amber-950">Only the maximum safe debit is applied now. The remaining debit becomes the canonical pending immediate remainder for renewal settlement.</p>}</div>}
    <p className="mt-3 font-medium">No tier, classification, payment, invoice, revenue, or validity change is included. Unused credits remain rollover.</p>
  </div>
}
