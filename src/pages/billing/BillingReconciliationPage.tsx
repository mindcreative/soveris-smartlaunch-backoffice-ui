import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { FINDING_TYPES, isReconciliationClient, normalizeReconciliationReason, type ReconciliationFilters } from '../../api/reconciliationApi'
import { ACTION_LABELS, useReconciliationWorkspace } from '../../queries/reconciliationQueries'
import type { ReconciliationAction, ReconciliationCase } from '../../types/reconciliation'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Modal } from '../../components/shared/Modal'
import { FormErrorSummary, type FormFieldError } from '../../components/shared/FormErrorSummary'
const control = 'min-h-11 min-w-11 max-w-full break-words rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-gray-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60'
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
function EvidenceValue({ value }: { value: unknown }) {
  if (value === null) return <span>Not recorded</span>
  if (Array.isArray(value)) return value.length ? <ol className="space-y-3">{value.map((entry, index) => <li key={index}><EvidenceValue value={entry} /></li>)}</ol> : <span>None recorded</span>
  if (typeof value === 'object') return <dl className="grid min-w-0 gap-2 sm:grid-cols-2">{Object.entries(value as Record<string, unknown>).map(([key, entry]) => <div key={key} className="min-w-0"><dt className="font-semibold">{label(key)}</dt><dd className="break-all"><EvidenceValue value={entry} /></dd></div>)}</dl>
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  return <span className="break-all">{String(value)}{typeof value === 'string' && /^\d+\.\d{4}$/.test(value) ? ' (exact recorded amount)' : ''}</span>
}
function CaseEvidence({ item }: { item: ReconciliationCase }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [item.finding.findingId])
  const sections = [
    ['Finding', item.finding], ['Accepted Job', item.job], ['Reservation — abstract Soveris credits', item.reservation],
    ['Attempts', item.attempts], ['Result metadata', item.result], ['Usage — abstract Soveris credits', item.usage],
    ['Provider expense — original currency and provenance', item.providerCosts], ['Correlation', item.correlation],
    ['Immutable finding evidence', item.evidence], ['Trusted provider proofs', item.providerProofs], ['Operator resolution audit', item.operatorResolution],
    ['Evidence keys', item.evidenceKeys], ['Evidence fingerprint', item.evidenceFingerprint],
  ] as const
  return <section aria-label="Case evidence" className="mt-6 min-w-0 rounded-md border border-gray-500 p-4 text-sm text-gray-950">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold focus-visible:outline focus-visible:outline-2">Immutable case evidence</h2>
    <p className="my-2 break-all">Case: {item.finding.findingId}</p>
    <p>Accepted evidence survives later capability changes. Capability loss does not authorize financial or execution changes.</p>
    {sections.map(([title, value]) => <details key={title} className="min-w-0 border-b border-gray-300 py-2"><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline focus-visible:outline-2">{title}</summary><EvidenceValue value={value} /></details>)}
    <h3 className="mt-4 font-semibold">Server action blockers</h3>
    {item.actionBlockers.length ? <ul>{item.actionBlockers.map(blocker => <li key={blocker}>{label(blocker)}</li>)}</ul> : <p>No blockers reported at evaluation time.</p>}
  </section>
}
const messages = {
  success: 'Resolution confirmed. Refresh cases to retrieve current state.',
  stale: 'Case state changed or the action was refused. No new operation will be sent. Refresh and review the evidence again.',
  denied: 'Reconciliation access denied. Private case data has been cleared.',
  error: 'The request could not be validated or fresh evidence could not be retrieved. Review again; no result is inferred.',
  unknown: 'Outcome unknown. This operation may already have committed. Keep this workspace open and check the same operation explicitly. Do not start another operation.',
}
function Workspace({ clientId }: { clientId: string }) {
  const state = useReconciliationWorkspace(clientId)
  const [type, setType] = useState('')
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const [age, setAge] = useState('')
  const [size, setSize] = useState('20')
  const [errors, setErrors] = useState<FormFieldError[]>([])
  const summary = useRef<HTMLDivElement>(null)
  const [reasonError, setReasonError] = useState<FormFieldError[]>([])
  const reasonSummary = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const actionTrigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const outcomeRegion = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  useEffect(() => { if (state.denied || (state.outcome && state.outcome !== 'unknown')) outcomeRegion.current?.focus() }, [state.denied, state.outcome])
  useLayoutEffect(() => { if (errors.length) summary.current?.focus() }, [errors])
  useLayoutEffect(() => { if (reasonError.length) reasonSummary.current?.focus() }, [reasonError])
  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    const invalid: FormFieldError[] = []
    if (age && (!/^[0-9]+$/.test(age) || Number(age) > 2147483647)) invalid.push({ fieldId: 'minimum-age', label: 'Minimum age', message: 'Enter whole seconds from 0 to 2147483647.' })
    setErrors(invalid); if (invalid.length) return
    const filters: ReconciliationFilters = { pageSize: Number(size), ...(type && { type: type as ReconciliationFilters['type'] }), ...(severity && { severity: severity as ReconciliationFilters['severity'] }), ...(status && { resolutionStatus: status as ReconciliationFilters['resolutionStatus'] }), ...(age && { minimumAgeSeconds: Number(age) }) }
    void state.load(filters)
  }
  const confirm = () => {
    try { normalizeReconciliationReason(state.reason) } catch { setReasonError([{ fieldId: 'resolution-reason', label: 'Reason', message: 'Enter 1–1000 characters without control characters.' }]); return }
    setReasonError([]); void state.submit(state.reason)
  }
  if (state.denied) return <div ref={outcomeRegion} role="alert" tabIndex={-1}><h1>Reconciliation access denied</h1><p>Private case data has been cleared. Current billing:reconcile authorization is required.</p></div>
  return <div className="mx-auto min-w-0 max-w-7xl break-words text-gray-950">
    <BillingWorkspaceNav clientId={clientId} />
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold focus-visible:outline focus-visible:outline-2">Reconciliation cases</h1>
    <p className="my-3 break-all">Selected Client: {clientId}</p>
    <form onSubmit={applyFilters} className="space-y-4 rounded-md border border-gray-500 p-4" aria-label="Reconciliation filters" aria-describedby="filter-context">
      <p id="filter-context">Apply filters to start a new snapshot. Unsaved filter changes do not change the displayed results.</p>
      <FormErrorSummary ref={summary} errors={errors} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="min-w-0">Finding type<select className={`${control} mt-1 w-full`} value={type} onChange={e => setType(e.target.value)}>{['', ...FINDING_TYPES].map(v => <option key={v} value={v}>{v ? label(v) : 'All types'}</option>)}</select></label>
        <label>Severity<select className={`${control} mt-1 w-full`} value={severity} onChange={e => setSeverity(e.target.value)}>{['', 'warning', 'error', 'critical'].map(v => <option key={v} value={v}>{v ? label(v) : 'All severities'}</option>)}</select></label>
        <label>Resolution status<select className={`${control} mt-1 w-full`} value={status} onChange={e => setStatus(e.target.value)}>{['', 'open', 'resolved'].map(v => <option key={v} value={v}>{v ? label(v) : 'All statuses'}</option>)}</select></label>
        <label>Minimum age (seconds)<input id="minimum-age" inputMode="numeric" value={age} onChange={e => setAge(e.target.value)} className={`${control} mt-1 w-full`} aria-invalid={errors.length > 0} aria-describedby={errors.length ? 'minimum-age-error' : undefined} />{errors.length > 0 && <span id="minimum-age-error" className="block text-red-950">{errors[0]!.message}</span>}</label>
        <label>Cases per page<select className={`${control} mt-1 w-full`} value={size} onChange={e => setSize(e.target.value)}>{['20', '50', '100'].map(v => <option key={v}>{v}</option>)}</select></label>
      </div>
      <button className={control} disabled={state.busy || state.uncertain}>Apply filters</button>
    </form>
    <div ref={outcomeRegion} role="status" aria-live="polite" tabIndex={-1} className="my-4 focus-visible:outline focus-visible:outline-2 space-y-2 break-words">
      {state.busy && <p>Loading and validating reconciliation state…</p>}
      {state.outcome && <p>{messages[state.outcome]}</p>}
      {state.receipt && <p>Operation {state.receipt.operationId}: {state.receipt.replayed ? 'Prior resolution replay confirmed' : 'Resolution applied'} at {state.receipt.resolvedAt}. {ACTION_LABELS[state.receipt.action as ReconciliationAction]}.</p>}
      {state.page && <p>Snapshot as of {state.page.asOf}. State evaluated at {state.page.evaluatedAt}. {state.items.length} cases loaded. {state.page.nextCursor ? 'More cases available.' : 'End of results.'}</p>}
      {state.error && <p>{state.items.length ? 'Partial results retained. Refresh failed; evidence and actions may be stale.' : 'Cases could not be verified or loaded. Refresh to try again.'}</p>}
    </div>
    {state.receipt && <section aria-label="Confirmed resolution state" className="my-4 min-w-0 rounded border border-gray-500 p-4"><h2 className="font-semibold">Confirmed resolution state</h2><EvidenceValue value={state.receipt.afterState} /></section>}
    {state.uncertain && <div className="my-4 rounded border-2 border-gray-700 p-4"><p>The exact confirmed command is retained for this actor and Client. Closing or navigating clears local recovery state; consult the case audit before any later resolution.</p><button className={control} disabled={state.busy} onClick={() => void state.replay()}>Check same operation</button></div>}
    <button className={control} disabled={state.busy || state.uncertain} onClick={() => void state.load()}>Refresh cases</button>
    {state.page && state.items.length === 0 && !state.busy && <p role="status" className="my-4">No reconciliation cases match these filters.</p>}
    {state.items.length > 0 && <>
      <div className="mt-4 hidden md:block"><table className="w-full table-fixed text-left text-sm"><caption className="py-3 text-left font-semibold">Reconciliation cases for the selected Client</caption><thead><tr>{['Case and type', 'Age', 'Severity', 'Status', 'Details'].map(v => <th scope="col" key={v} className="border-b border-gray-500 p-2">{v}</th>)}</tr></thead><tbody>{state.items.map(item => <tr key={item.finding.findingId}><th scope="row" className="break-all border-b border-gray-300 p-2">{item.finding.findingId}<br />{label(item.finding.findingType)}</th><td className="border-b p-2">{item.finding.ageSeconds} seconds</td><td className="border-b p-2">{label(item.finding.severity)}</td><td className="border-b p-2">{label(item.finding.resolutionStatus)}</td><td className="border-b p-2"><button className={`${control} w-full break-words`} disabled={state.busy} onClick={() => state.select(item)} aria-label={`Inspect case ${item.finding.findingId}`}>Inspect case</button></td></tr>)}</tbody></table></div>
      <ul className="mt-4 space-y-3 md:hidden" aria-label="Reconciliation cases">{state.items.map(item => <li key={item.finding.findingId} className="min-w-0 rounded border border-gray-500 p-3"><p className="break-all">Case: {item.finding.findingId}</p><p>{label(item.finding.findingType)}; {item.finding.ageSeconds} seconds old; {label(item.finding.severity)}; {label(item.finding.resolutionStatus)}</p><button className={`${control} mt-2`} disabled={state.busy} onClick={() => state.select(item)} aria-label={`Inspect case ${item.finding.findingId}`}>Inspect case</button></li>)}</ul>
    </>}
    {state.page?.nextCursor && <button className={`${control} mt-4`} disabled={state.busy || state.uncertain} onClick={() => void state.load(undefined, true)}>Load more cases</button>}
    {state.selected && <><CaseEvidence item={state.selected} /><div className="mt-3 flex flex-wrap gap-3" aria-label="Server-authorized resolution actions">{state.selected.allowedActions.map(action => <button key={action} className={control} disabled={state.busy || state.uncertain} onClick={event => { actionTrigger.current = event.currentTarget; setReasonError([]); void state.review(state.selected!, action as ReconciliationAction) }}>{ACTION_LABELS[action as ReconciliationAction]}</button>)}{state.selected.allowedActions.length === 0 && <p>No resolution action is currently authorized by the server.</p>}</div></>}
    <Modal isOpen={!!state.confirmation} title="Confirm case action" onClose={state.closeConfirmation} closeDisabled={state.busy} closeOnBackdropClick={false} initialFocusRef={cancel} returnFocusRef={actionTrigger} descriptionId="resolution-effect" footer={<div className="flex flex-wrap gap-3"><button ref={cancel} className={control} disabled={state.busy} onClick={state.closeConfirmation}>Cancel confirmation</button>{!state.uncertain && <button className={control} disabled={state.busy} onClick={confirm}>{state.busy ? 'Validating resolution…' : 'Confirm resolution'}</button>}</div>}>
      {state.confirmation && <div className="min-w-0 space-y-4 break-words text-sm text-gray-950">
        <p className="break-all">Client: {clientId}</p><p className="break-all">Case: {state.confirmation.item.finding.findingId}</p><p>Action: {ACTION_LABELS[state.confirmation.action]}</p><p id="resolution-effect">{state.confirmation.effect}</p>
        <FormErrorSummary ref={reasonSummary} errors={reasonError} />
        <label className="block" htmlFor="resolution-reason">Reason (required)</label><textarea id="resolution-reason" required value={state.reason} disabled={state.busy || state.uncertain} onChange={e => state.setReason(e.target.value)} aria-invalid={reasonError.length > 0} aria-describedby="reason-help" className={`${control} w-full`} />
        <p id="reason-help">{reasonError.length ? reasonError[0]!.message : '1–1000 characters. This reason is recorded in the immutable audit.'}</p>
        <p>State is checked again before submission. Cancel returns without submitting.</p>
        <p role="status">{state.busy ? 'Validating fresh state and submitting one operation…' : state.outcome ? messages[state.outcome] : ''}</p>
        {state.uncertain && <button className={control} onClick={() => void state.replay()} disabled={state.busy}>Check same operation</button>}
      </div>}
    </Modal>
  </div>
}
export function BillingReconciliationPage() {
  const { clientId = '' } = useParams()
  const location = useLocation()
  const [authorityEpoch, setAuthorityEpoch] = useState(0)
  useLayoutEffect(() => {
    const reset = () => flushSync(() => setAuthorityEpoch(value => value + 1))
    window.addEventListener('auth:refreshed', reset)
    window.addEventListener('auth:cleared', reset)
    return () => { window.removeEventListener('auth:refreshed', reset); window.removeEventListener('auth:cleared', reset) }
  }, [])
  const { user, isAuthenticated, hasPermission, accessToken } = useAuth()
  if (!isAuthenticated || !hasPermission('billing:reconcile')) return <div><h1>Reconciliation access unavailable</h1><p>Current billing:reconcile permission is required.</p></div>
  if (!isReconciliationClient(clientId)) return <div><h1>Invalid Client context</h1><p>Open a canonical Client reconciliation URL.</p></div>
  if (!user || (user.role !== 'Admin' && user.clientId !== clientId)) return <div><h1>Reconciliation access unavailable</h1><p>This Client is outside your current authorized scope.</p></div>
  return <Workspace key={`${authorityEpoch}:${location.key}:${clientId}:${user.id}:${user.clientId}:${user.role}:${accessToken}`} clientId={clientId} />
}
