import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import {
  createLocalSubscription, previewLocalSubscription, serializeLocalSubscriptionRequest,
  type LocalSubscriptionMaterial,
  type ResolvedLocalSubscriptionPreview, type LocalSubscriptionReceipt,
} from '../../api/localSubscriptionApi'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { createUuidV7 } from '../../lib/uuidV7'
import { billingAccountKeys, billingSubscriptionKeys } from '../../queries/billingQueries'
import { normalizeLocalWallInput, LocalInstant } from '../../timezone/LocalInstant'
import { Modal } from '../shared/Modal'

type EndChoice = '' | 'ongoing' | 'finite'
interface Draft {
  planName: string; subscriptionTier: '' | 'basic' | 'brand' | 'brand_premium'
  cycleCreditAmount: string; requestsPerMinute: string; concurrentAiOperations: string
  contentGeneration: boolean; imageGeneration: boolean; validFrom: string
  endChoice: EndChoice; endCycleIndex: string
}
const EMPTY: Draft = {
  planName: '', subscriptionTier: '', cycleCreditAmount: '', requestsPerMinute: '',
  concurrentAiOperations: '', contentGeneration: false, imageGeneration: false,
  validFrom: '', endChoice: '', endCycleIndex: '',
}
interface RetainedAttempt { body: string; operationId: string }
const uncertainAttempts = new Map<string, RetainedAttempt>()
if (typeof window !== 'undefined') window.addEventListener('auth:cleared', () => uncertainAttempts.clear())
let retainedActorId: string | null = null

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status : undefined
}

function validateDraft(draft: Draft): { material: LocalSubscriptionMaterial | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  let wall = ''
  try { wall = normalizeLocalWallInput(draft.validFrom) }
  catch { errors.validFrom = 'Enter a valid local date and time.' }
  if (!draft.planName || draft.planName.length > 128 || draft.planName.trim() !== draft.planName)
    errors.planName = 'Use 1–128 characters without surrounding spaces.'
  if (!['basic', 'brand', 'brand_premium'].includes(draft.subscriptionTier))
    errors.subscriptionTier = 'Choose a paid tier.'
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(draft.cycleCreditAmount) ||
      /^0(?:\.0+)?$/.test(draft.cycleCreditAmount))
    errors.cycleCreditAmount = 'Enter a positive amount with up to four decimal places.'
  const rpm = Number(draft.requestsPerMinute)
  const concurrent = Number(draft.concurrentAiOperations)
  if (!/^[1-9]\d*$/.test(draft.requestsPerMinute) || rpm > 10000)
    errors.requestsPerMinute = 'Enter a whole number from 1 to 10,000.'
  if (!/^[1-9]\d*$/.test(draft.concurrentAiOperations) || concurrent > 1000)
    errors.concurrentAiOperations = 'Enter a whole number from 1 to 1,000.'
  if (!draft.contentGeneration && !draft.imageGeneration)
    errors.features = 'Choose at least one feature.'
  if (!draft.endChoice) errors.endChoice = 'Choose ongoing or a finite number of cycles.'
  const cycles = Number(draft.endCycleIndex)
  if (draft.endChoice === 'finite' && (!/^[1-9]\d*$/.test(draft.endCycleIndex) ||
      !Number.isSafeInteger(cycles) || cycles > 1200))
    errors.endCycleIndex = 'Enter a whole number from 1 to 1,200.'
  if (Object.keys(errors).length) return { material: null, errors }
  return { errors, material: {
    planName: draft.planName, subscriptionTier: draft.subscriptionTier as LocalSubscriptionMaterial['subscriptionTier'],
    cycleCreditAmount: draft.cycleCreditAmount, validFrom: wall,
    endCycleIndex: draft.endChoice === 'ongoing' ? null : cycles,
    changeEffectivePolicy: 'immediate', prorationPolicy: 'replace', unusedCreditPolicy: 'rollover',
    entitlements: { schemaVersion: 1, rateLimits: { requestsPerMinute: rpm,
      concurrentAiOperations: concurrent }, featureFlags: {
      contentGeneration: draft.contentGeneration, imageGeneration: draft.imageGeneration,
    } },
  } }
}

export function LocalSubscriptionCreationWorkspace({ clientId, onPreconfirm, onCreated }: {
  clientId: string
  onPreconfirm: () => Promise<boolean>
  onCreated: (receipt: LocalSubscriptionReceipt) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const attemptKey = `${user?.id ?? ''}:${clientId}`
  if (retainedActorId !== (user?.id ?? null)) {
    uncertainAttempts.clear()
    retainedActorId = user?.id ?? null
  }
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ResolvedLocalSubscriptionPreview | null>(null)
  const [material, setMaterial] = useState<LocalSubscriptionMaterial | null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(() => uncertainAttempts.has(attemptKey))
  const [feedback, setFeedback] = useState('')
  const summaryRef = useRef<HTMLDivElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement>(null)
  const requestEpoch = useRef(0)

  useEffect(() => {
    if (Object.keys(errors).length > 0) summaryRef.current?.focus()
  }, [errors])

  useEffect(() => {
    setUncertain(uncertainAttempts.has(attemptKey))
    setPreview(null)
    setMaterial(null)
    setFeedback('')
    requestEpoch.current += 1
  }, [attemptKey])

  const update = (field: keyof Draft, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setPreview(null)
    setMaterial(null)
    setErrors({})
    requestEpoch.current += 1
  }

  const review = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || uncertain) return
    const validated = validateDraft(draft)
    setErrors(validated.errors)
    if (!validated.material) return
    const epoch = ++requestEpoch.current
    setBusy(true)
    setFeedback('Checking the local time and billing boundaries…')
    try {
      if (!await onPreconfirm()) {
        setFeedback('Fresh Client or account authority no longer permits creation. Review the current state and retry.')
        return
      }
      const result = await previewLocalSubscription(clientId,
        { validFrom: validated.material.validFrom,
          endCycleIndex: validated.material.endCycleIndex })
      if (epoch !== requestEpoch.current) return
      if (result.validFrom !== validated.material.validFrom ||
          result.endCycleIndex !== validated.material.endCycleIndex)
        throw new Error('Preview differs from the requested local time')
      setMaterial(validated.material)
      setPreview(result)
      returnFocusRef.current = reviewButtonRef.current
    } catch (error) {
      if (epoch !== requestEpoch.current) return
      if (errorStatus(error) === 422) {
        setErrors({ validFrom: 'This time does not exist or occurs twice in your saved timezone. Choose another time.' })
      } else setFeedback('Preview could not be verified. Your entries are retained; retry review.')
    } finally { if (epoch === requestEpoch.current) setBusy(false) }
  }

  const send = async (retained: RetainedAttempt) => {
    if (busy) return
    const actorId = user?.id
    const scopeKey = attemptKey
    const epoch = requestEpoch.current
    const currentScope = () => actorId === useAuthStore.getState().user?.id &&
      scopeKey === `${useAuthStore.getState().user?.id ?? ''}:${clientId}` &&
      epoch === requestEpoch.current
    setBusy(true)
    setFeedback('Creating or replaying the retained subscription operation…')
    try {
      const receipt = await createLocalSubscription(clientId, retained.body,
        retained.operationId)
      if (!currentScope()) return
      uncertainAttempts.delete(attemptKey)
      setUncertain(false)
      setFeedback('')
      onCreated(receipt)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: billingSubscriptionKeys.state(clientId), exact: true }),
        queryClient.invalidateQueries({ queryKey: billingAccountKeys.account(clientId), exact: true }),
      ])
    } catch (error) {
      if (!currentScope()) return
      const status = errorStatus(error)
      if (status === 400 || status === 404 || status === 409 || status === 422) {
        uncertainAttempts.delete(attemptKey)
        setUncertain(false)
        setFeedback('The server rejected this operation. Review the saved values and request a new preview.')
      } else {
        setUncertain(true)
        setFeedback(status === 401 || status === 403
          ? 'Access changed. This attempt is retained; sign in with authorized access before replay.'
          : 'Outcome unknown. Replay the exact retained request to learn the result.')
      }
    } finally { if (currentScope()) setBusy(false) }
  }

  const confirm = () => {
    if (!material || !preview || busy || uncertain) return
    const operationId = createUuidV7()
    const body = serializeLocalSubscriptionRequest(material, preview, operationId)
    const retained = Object.freeze({ body, operationId })
    uncertainAttempts.set(attemptKey, retained)
    setPreview(null)
    setMaterial(null)
    void send(retained)
  }

  return <section aria-labelledby="local-subscription-heading" className="min-w-0 max-w-full rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
    <h2 id="local-subscription-heading" className="text-lg font-semibold">Create subscription</h2>
    <p className="mt-1 text-sm text-gray-700">Enter the start in your saved timezone. The server determines billing boundaries.</p>
    {Object.keys(errors).length > 0 && <div ref={summaryRef} tabIndex={-1} role="alert" aria-label="Correct the subscription form" className="mt-3 rounded border border-red-300 p-3 outline-none">
      <p className="font-semibold">Correct the subscription form.</p>
      <ul className="list-disc pl-5">{Object.entries(errors).map(([field, message]) => <li key={field}><a href={`#local-subscription-${field}`} className="underline">{message}</a></li>)}</ul>
    </div>}
    {feedback && <p role="status" className="mt-3 rounded border border-indigo-200 p-3">{feedback}</p>}
    {uncertain && <div className="mt-3 rounded border border-amber-300 p-3" role="alert"><p>The exact operation ID and request bytes are retained for this Client.</p>
      <button type="button" disabled={busy} onClick={() => { const retained = uncertainAttempts.get(attemptKey); if (retained) void send(retained) }} className="mt-2 min-h-11 rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-50">Replay exact request</button>
      <button type="button" disabled={busy} onClick={() => { uncertainAttempts.delete(attemptKey); setUncertain(false); setFeedback('A new operation can now be reviewed.') }} className="ml-2 min-h-11 rounded border px-4 py-2 disabled:opacity-50">Abandon unresolved attempt</button>
    </div>}
    <form onSubmit={(event) => { void review(event) }} className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      {([
        ['planName', 'Plan name', 'text'], ['cycleCreditAmount', 'Cycle credits', 'text'],
        ['requestsPerMinute', 'Requests per minute', 'number'],
        ['concurrentAiOperations', 'Concurrent AI operations', 'number'],
        ['validFrom', 'Valid from', 'datetime-local'],
      ] as const).map(([field, label, type]) => <div key={field} className="min-w-0"><label htmlFor={`local-subscription-${field}`} className="block font-medium">{label}</label>
        <input id={`local-subscription-${field}`} type={type} value={draft[field]} onChange={(event) => update(field, event.target.value)}
          disabled={busy || uncertain} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `local-subscription-${field}-error` : undefined}
          className="mt-1 min-h-11 min-w-0 w-full max-w-full rounded border px-3 py-2" />{errors[field] && <p id={`local-subscription-${field}-error`} className="text-red-700">{errors[field]}</p>}</div>)}
      <div><label htmlFor="local-subscription-subscriptionTier" className="block font-medium">Subscription tier</label>
        <select id="local-subscription-subscriptionTier" value={draft.subscriptionTier} disabled={busy || uncertain} required onChange={(event) => update('subscriptionTier', event.target.value)} className="mt-1 min-h-11 w-full rounded border px-3 py-2"><option value="">Select a tier</option><option value="basic">Basic</option><option value="brand">Brand</option><option value="brand_premium">Brand Premium</option></select></div>
      <fieldset className="rounded border p-3 sm:col-span-2"><legend className="font-medium">Features</legend>
        <label className="mr-5 inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.contentGeneration} onChange={(event) => update('contentGeneration', event.target.checked)} disabled={busy || uncertain} />Content generation</label>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.imageGeneration} onChange={(event) => update('imageGeneration', event.target.checked)} disabled={busy || uncertain} />Image generation</label></fieldset>
      <fieldset className="rounded border p-3 sm:col-span-2"><legend className="font-medium">End of subscription</legend>
        <label className="mr-5 inline-flex min-h-11 items-center gap-2"><input type="radio" name="endChoice" checked={draft.endChoice === 'ongoing'} onChange={() => update('endChoice', 'ongoing')} disabled={busy || uncertain} />Ongoing (no end)</label>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="endChoice" checked={draft.endChoice === 'finite'} onChange={() => update('endChoice', 'finite')} disabled={busy || uncertain} />Finite billing cycles</label>
        {draft.endChoice === 'finite' && <div><label htmlFor="local-subscription-endCycleIndex" className="block">Number of cycles</label><input id="local-subscription-endCycleIndex" type="number" min="1" max="1200" value={draft.endCycleIndex} onChange={(event) => update('endCycleIndex', event.target.value)} disabled={busy || uncertain} className="min-h-11 rounded border px-3 py-2" /></div>}</fieldset>
      <div className="sm:col-span-2"><button ref={reviewButtonRef} type="submit" disabled={busy || uncertain} className="min-h-11 rounded bg-indigo-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Review subscription</button></div>
    </form>
    <Modal isOpen={Boolean(preview && material)} onClose={() => { setPreview(null); setMaterial(null) }} returnFocusRef={returnFocusRef} title="Confirm subscription creation" size="lg" footer={<div className="flex justify-end gap-3"><button type="button" onClick={() => { setPreview(null); setMaterial(null) }} className="min-h-11 rounded border px-4 py-2">Cancel</button><button type="button" onClick={confirm} className="min-h-11 rounded bg-indigo-700 px-4 py-2 text-white">Confirm creation</button></div>}>
      {preview && material && <dl className="grid gap-3 sm:grid-cols-2"><div><dt>Client</dt><dd>{clientId}</dd></div><div><dt>Plan</dt><dd>{material.planName}</dd></div><div><dt>Subscription tier</dt><dd>{material.subscriptionTier === 'brand_premium' ? 'Brand Premium' : material.subscriptionTier === 'brand' ? 'Brand' : 'Basic'}</dd></div><div><dt>Cycle credits</dt><dd>{material.cycleCreditAmount}</dd></div><div><dt>Valid from</dt><dd><LocalInstant value={preview.validFrom} /></dd></div><div><dt>First billing boundary</dt><dd><LocalInstant value={preview.firstCycleBoundary} /></dd></div><div><dt>Valid to</dt><dd>{preview.validTo ? <LocalInstant value={preview.validTo} /> : 'Ongoing (no end)'}</dd></div><div><dt>Features</dt><dd>{[material.entitlements.featureFlags.contentGeneration && 'Content generation', material.entitlements.featureFlags.imageGeneration && 'Image generation'].filter(Boolean).join(', ')}</dd></div><div><dt>Requests per minute</dt><dd>{material.entitlements.rateLimits.requestsPerMinute}</dd></div><div><dt>Concurrent AI operations</dt><dd>{material.entitlements.rateLimits.concurrentAiOperations}</dd></div></dl>}
    </Modal>
  </section>
}

export function LocalSubscriptionCreatedNotice({ receipt }: { receipt: LocalSubscriptionReceipt }) {
  return <section role="status" className="rounded border border-green-300 bg-green-50 p-4">
    <h2 className="font-semibold">{receipt.created ? 'Subscription created' : 'Exact operation replayed'}</h2>
    <p>Operation {receipt.subscription.creationOperationId}</p>
    <p>Valid from: <LocalInstant value={receipt.subscription.validFrom} /></p>
    <p>Valid to: {receipt.subscription.validTo ? <LocalInstant value={receipt.subscription.validTo} /> : 'Ongoing (no end)'}</p>
    <p>First billing boundary: <LocalInstant value={receipt.initialGrant.cycleEnd} /></p>
    <p>Grant {receipt.initialGrant.grantId}; ledger entry {receipt.initialGrant.ledgerEntryId}</p>
  </section>
}
