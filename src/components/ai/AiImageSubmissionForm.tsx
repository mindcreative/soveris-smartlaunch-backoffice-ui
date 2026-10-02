import { useEffect, useRef, useState } from 'react'
import type { useAiImageAdmission } from '../../queries/aiImageQueries'
import type { AiImageCapabilityPresentation } from './aiImageCapability'
import type { AiImageTargetRole } from '../../types/aiImages'
import { FormErrorSummary, type FormFieldError } from '../shared/FormErrorSummary'

type AdmissionController = ReturnType<typeof useAiImageAdmission>

export function AiImageSubmissionForm({
  clientId, capability, capabilityLoading, admission,
}: {
  clientId: string
  capability: AiImageCapabilityPresentation
  capabilityLoading: boolean
  admission: AdmissionController
}) {
  const [prompt, setPrompt] = useState('')
  const [targetRole, setTargetRole] = useState<AiImageTargetRole>('hero')
  const [errors, setErrors] = useState<FormFieldError[]>([])
  const [, setRetryClock] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousPhaseRef = useRef(admission.state.phase)
  const reviewReady = admission.state.phase === 'review_ready' && admission.state.quote !== null
  const submissionRetained = ['submitting', 'admission_unknown', 'rate_limited'].includes(admission.state.phase) &&
    admission.state.quote !== null
  const inputsLocked = admission.state.phase === 'submitting' || submissionRetained
  const retryBlocked = admission.state.retryAfterUntil !== null && Date.now() < admission.state.retryAfterUntil
  const canReview = !capabilityLoading && capability.capabilityEligible && !inputsLocked &&
    admission.state.phase !== 'requesting_quote' && admission.state.phase !== 'permission_lost' &&
    admission.state.phase !== 'acknowledged' && !retryBlocked

  useEffect(() => {
    if (admission.state.retryAfterUntil === null) return
    const remaining = admission.state.retryAfterUntil - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRetryClock((value) => value + 1), remaining + 10)
    return () => window.clearTimeout(timer)
  }, [admission.state.retryAfterUntil])

  useEffect(() => {
    const previous = previousPhaseRef.current
    previousPhaseRef.current = admission.state.phase
    if (admission.state.phase === 'review_ready' && previous !== 'review_ready')
      requestAnimationFrame(() => confirmationHeadingRef.current?.focus())
    if (['quote_expired', 'quote_stale', 'quote_not_available'].includes(admission.state.phase) &&
        admission.state.phase !== previous)
      requestAnimationFrame(() => reviewButtonRef.current?.focus())
  }, [admission.state.phase])

  useEffect(() => {
    const clearPrivateForm = () => {
      setPrompt('')
      setTargetRole('hero')
      setErrors([])
      requestAnimationFrame(() => headingRef.current?.focus())
    }
    window.addEventListener('auth:cleared', clearPrivateForm)
    window.addEventListener('auth:refreshed', clearPrivateForm)
    window.addEventListener('popstate', clearPrivateForm)
    return () => {
      window.removeEventListener('auth:cleared', clearPrivateForm)
      window.removeEventListener('auth:refreshed', clearPrivateForm)
      window.removeEventListener('popstate', clearPrivateForm)
    }
  }, [])

  useEffect(() => {
    if (capability.reason !== 'missing_permission') return
    setPrompt('')
    setTargetRole('hero')
    setErrors([])
  }, [capability.reason])

  const discardQuote = () => {
    setErrors([])
    admission.discardReview()
  }

  const review = () => {
    const next: FormFieldError[] = []
    const length = prompt.trim().length
    if (length < 1) next.push({ fieldId: 'ai-image-prompt', label: 'Image prompt', message: 'Enter a prompt before review.' })
    else if (length > 4_000) next.push({ fieldId: 'ai-image-prompt', label: 'Image prompt', message: 'Use no more than 4,000 characters.' })
    if (!['hero', 'feature'].includes(targetRole)) next.push({ fieldId: 'ai-image-target-role', label: 'Target role', message: 'Choose a supported target role.' })
    setErrors(next)
    if (next.length > 0) {
      admission.discardReview()
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    admission.review(prompt, targetRole)
  }

  const quote = admission.state.quote
  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); review() }} aria-labelledby="ai-image-form-heading" className="min-w-0 space-y-5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div>
        <h2 ref={headingRef} id="ai-image-form-heading" tabIndex={-1} className="text-lg font-semibold text-gray-950">Generate one private image</h2>
        <p className="mt-1 text-sm text-gray-700">Enter a prompt and choose where the image is intended to be used. Count is always one.</p>
      </div>

      <FormErrorSummary ref={summaryRef} errors={errors} />

      <label htmlFor="ai-image-prompt" className="block text-sm font-medium text-gray-950">
        Image prompt
        <textarea
          id="ai-image-prompt" required maxLength={4000} rows={6} value={prompt} disabled={inputsLocked}
          onChange={(event) => { setPrompt(event.target.value); discardQuote() }}
          aria-describedby="ai-image-prompt-help ai-image-prompt-count"
          className="mt-1 min-h-28 w-full resize-y rounded-md border border-gray-400 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
      </label>
      <div className="-mt-4 flex flex-wrap justify-between gap-2 text-sm text-gray-600">
        <p id="ai-image-prompt-help">Use 1–4,000 characters. The prompt stays in this page only.</p>
        <p id="ai-image-prompt-count">{prompt.length} / 4,000</p>
      </div>

      <fieldset id="ai-image-target-role" disabled={inputsLocked}>
        <legend className="text-sm font-medium text-gray-950">Target role</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {([['hero', 'Hero image'], ['feature', 'Feature image']] as const).map(([value, label]) => (
            <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-600">
              <input type="radio" name="target-role" value={value} checked={targetRole === value} onChange={() => { setTargetRole(value); discardQuote() }} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {reviewReady && quote && <section aria-labelledby="ai-image-confirmation-heading" className="min-w-0 rounded-md border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
        <h3 ref={confirmationHeadingRef} id="ai-image-confirmation-heading" tabIndex={-1} className="font-semibold">Confirm image Job</h3>
        <dl className="mt-2 grid min-w-0 gap-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium">Current Client</dt><dd className="break-all font-mono">{clientId}</dd>
          <dt className="font-medium">Image action</dt><dd>Generate one private {quote.targetRole} image</dd>
          <dt className="font-medium">Quoted amount</dt><dd>{quote.quotedCredits} abstract credits</dd>
          <dt className="font-medium">Rule version</dt><dd className="break-words">{quote.ruleVersion}</dd>
          <dt className="font-medium">Quote expires</dt><dd><time dateTime={quote.expiresAt}>{quote.expiresAt} (UTC)</time></dd>
          <dt className="font-medium">Cancellation</dt><dd>Cancel before submission. An acknowledged asynchronous Job cannot be cancelled here.</dd>
        </dl>
        <p className="mt-3">This is a short-lived server quote, not a reservation or charge. Submission may reserve the exact quoted amount.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => admission.confirm(prompt, targetRole)} className="min-h-11 min-w-11 rounded-md bg-indigo-700 px-4 py-2 font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2">Submit image Job</button>
          <button type="button" onClick={() => { admission.discardReview(); requestAnimationFrame(() => reviewButtonRef.current?.focus()) }} className="min-h-11 min-w-11 rounded-md border border-amber-900 px-4 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Cancel review</button>
        </div>
      </section>}

      {admission.state.phase !== 'idle' && admission.state.phase !== 'review_ready' && (
        <div role={['validation', 'permission_lost', 'quote_expired', 'quote_stale', 'quote_not_available', 'conflict'].includes(admission.state.phase) ? 'alert' : 'status'} aria-live="polite" className="rounded-md border border-gray-400 bg-gray-50 p-3 text-sm text-gray-900">
          {admission.state.message}
        </div>
      )}

      {submissionRetained && (
        <button type="button" disabled={admission.state.phase === 'submitting' || retryBlocked} onClick={() => admission.recover()} className="min-h-11 min-w-11 rounded-md border border-indigo-700 px-4 py-2 font-medium text-indigo-800 disabled:cursor-not-allowed disabled:opacity-60">
          Retry exact submission
        </button>
      )}

      <div className={capability.capabilityEligible ? 'rounded-md border border-green-700 bg-green-50 p-3 text-sm text-green-950' : 'rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-950'} role={capability.capabilityEligible ? 'status' : 'alert'}>
        {capabilityLoading ? 'Checking current Client capability…' : capability.message}
      </div>

      <button ref={reviewButtonRef} type="submit" disabled={!canReview} className="min-h-11 min-w-11 rounded-md border border-indigo-700 px-4 py-2 font-medium text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-60">{admission.state.phase === 'requesting_quote' ? 'Requesting quote…' : 'Review and quote'}</button>
      <p className="text-sm text-gray-700">Review requests a fresh short-lived quote for the selected role. It does not reserve or charge credits.</p>
    </form>
  )
}
