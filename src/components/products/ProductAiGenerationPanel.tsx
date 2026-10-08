import { useEffect, useMemo, useRef, useState } from 'react'
import { AiBackendPreparationButton } from '../ai/AiBackendPreparationButton'
import { useAuth } from '../../hooks/useAuth'
import { useClientCapabilities } from '../../queries/billingQueries'
import { useAiContentGeneration } from '../../queries/aiContentQueries'
import type { Product, ProductContentV1 } from '../../types/content'
import type { AiGenerationMaterial, AiGenerationTarget, AiContentTone } from '../../types/aiContent'
import { presentAiContentCapability } from './aiContentCapability'
import { aiApplyTargets, readAiScalar, type AiApplyOutcome, type VerifiedAiApplySelection } from './productAiApply'
import { ProductContentPreview } from './ProductContentPreview'

interface ProductAiGenerationPanelProps {
  clientId: string
  product: Product
  working: ProductContentV1
  draftRevision: number
  dirty: boolean
  applyPending: boolean
  onApply: (selection: VerifiedAiApplySelection) => Promise<AiApplyOutcome>
}

const targetLabels: Record<AiGenerationTarget, string> = {
  hero: 'Hero section copy', features: 'Features section copy', faq: 'Questions section copy',
  cta: 'Call-to-action text', description: 'Descriptive copy', headline: 'Headline',
  meta_title: 'SEO meta title', meta_description: 'SEO meta description',
  rewrite: 'Rewrite hero subtitle', image_prompt: 'Image prompt (text only)',
}

export function selectAiCurrentValue(content: ProductContentV1, target: AiGenerationTarget): string {
  switch (target) {
    case 'hero': return [content.hero.title, content.hero.subtitle].filter(Boolean).join('\n')
    case 'features': return content.features
      ? [content.features.heading, content.features.description, ...content.features.items.flatMap((item) => [item.title, item.description])].filter(Boolean).join('\n') : ''
    case 'faq': return content.questions
      ? [content.questions.heading, content.questions.description, ...content.questions.items.flatMap((item) => [item.question, item.answer])].filter(Boolean).join('\n') : ''
    case 'cta': return content.hero.cta.label
    case 'description': return content.hero.subtitle
    case 'headline': return content.hero.title
    case 'meta_title': return content.seo?.metaTitle ?? ''
    case 'meta_description': return content.seo?.metaDescription ?? ''
    case 'rewrite': return content.hero.subtitle
    case 'image_prompt': return content.hero.backgroundImage.alt
  }
}

function actionable(phase: string): boolean {
  return ['validation', 'insufficient_credits', 'admission_unknown', 'rate_limited', 'permission_lost', 'unavailable', 'contract_invalid', 'failed', 'execution_unknown', 'cancelled', 'delayed'].includes(phase)
}

export function ProductAiGenerationPanel({ clientId, product, working, draftRevision, dirty, applyPending, onApply }: ProductAiGenerationPanelProps) {
  const { user, hasPermission } = useAuth()
  const capabilities = useClientCapabilities(clientId)
  const [target, setTarget] = useState<AiGenerationTarget>('hero')
  const [targetAudience, setTargetAudience] = useState('')
  const [tone, setTone] = useState<AiContentTone | ''>('')
  const [variations, setVariations] = useState(1)
  const [instructions, setInstructions] = useState('')
  const [targetPointer, setTargetPointer] = useState('')
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null)
  const [applyReview, setApplyReview] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [applying, setApplying] = useState(false)
  const [, setRetryClock] = useState(0)
  const hasCreate = hasPermission('ai:create')
  const hasView = hasPermission('ai:view')
  const hasProductView = hasPermission('products:view')
  const hasProductUpdate = hasPermission('products:update')
  const presentation = useMemo(() => presentAiContentCapability(capabilities.data, hasCreate, hasView), [capabilities.data, hasCreate, hasView])
  const authorized = Boolean(user?.id && hasCreate && hasView)
  const workflow = useAiContentGeneration({ actorId: user?.id ?? '', clientId, productId: product.id, classification: capabilities.data?.classification ?? 'customer', authorized })
  const errorRef = useRef<HTMLDivElement>(null)
  const generateRef = useRef<HTMLButtonElement>(null)
  const reviewApplyRef = useRef<HTMLButtonElement>(null)
  const lastFocusedPhase = useRef('')
  const currentValue = selectAiCurrentValue(working, target)
  const applyTargets = useMemo(() => aiApplyTargets(working, target), [target, working])
  const attempt = workflow.state.attempt
  const draftMoved = Boolean(attempt && (draftRevision !== attempt.material.draftRevision ||
    selectAiCurrentValue(working, attempt.material.target) !== attempt.material.currentValue ||
    (attempt.material.targetPointer !== null && readAiScalar(working, attempt.material.targetPointer) !== attempt.material.targetValue)))
  const retainedLocked = Boolean(workflow.state.jobId) || ['submitting', 'polling', 'admission_unknown', 'rate_limited', 'completed', 'failed', 'execution_unknown', 'cancelled', 'contract_invalid', 'permission_lost', 'unavailable'].includes(workflow.state.phase)
  const rewriteTooShort = target === 'rewrite' && currentValue.trim().length < 10
  const targetBound = target === 'image_prompt' || Boolean(targetPointer)
  const canGenerate = presentation.eligible && !capabilities.isFetching && !retainedLocked && !rewriteTooShort && targetBound
  const checkedText = workflow.state.lastCheckedAt === null ? null : new Date(workflow.state.lastCheckedAt).toLocaleTimeString()

  useEffect(() => {
    if (!actionable(workflow.state.phase) || lastFocusedPhase.current === workflow.state.phase) return
    lastFocusedPhase.current = workflow.state.phase
    requestAnimationFrame(() => errorRef.current?.focus())
  }, [workflow.state.phase])

  useEffect(() => {
    if (workflow.state.retryAfterUntil === null) return
    const remaining = workflow.state.retryAfterUntil - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRetryClock((value) => value + 1), remaining + 10)
    return () => window.clearTimeout(timer)
  }, [workflow.state.retryAfterUntil])

  useEffect(() => {
    setTargetPointer((current) => applyTargets.some((option) => option.pointer === current)
      ? current
      : applyTargets.length === 1 ? applyTargets[0]!.pointer : '')
  }, [applyTargets, target])

  useEffect(() => {
    setSelectedVariation(null)
    setApplyReview(false)
    setApplyError('')
  }, [workflow.state.job?.result?.resultId])

  const submit = () => {
    const material: AiGenerationMaterial = {
      target, currentValue, productSlug: working.slug || product.slug,
      targetPointer: targetPointer || null,
      targetValue: targetPointer ? readAiScalar(working, targetPointer) ?? '' : '',
      draftRevision,
      productName: working.name || product.name, targetAudience: targetAudience.trim(),
      tone: tone || null, variations, instructions: instructions.trim(),
    }
    workflow.generate(material)
  }

  const confirmApply = async () => {
    const before = workflow.state
    const result = before.job?.result
    const pointer = before.attempt?.material.targetPointer
    if (applying || applyPending || selectedVariation === null || !before.attempt || !before.jobId ||
      !result || !pointer || dirty || !hasView || !hasProductView || !hasProductUpdate) return
    const selected = result.variations[selectedVariation]
    const destination = aiApplyTargets(working, before.attempt.material.target).find((item) => item.pointer === pointer)
    if (selected === undefined || !destination) {
      setApplyError('The selected variation or destination is no longer valid. Choose it again.')
      setApplyReview(false)
      return
    }
    setApplying(true)
    setApplyError('')
    const verified = await workflow.recheckCompleted()
    if (!verified || verified.status !== 'completed' || verified.guidance.code !== 'complete' ||
      verified.guidance.poll || verified.guidance.action !== 'view_result' ||
      verified.jobId !== before.jobId || verified.result?.resultId !== result.resultId ||
      JSON.stringify(verified.result.variations) !== JSON.stringify(result.variations) ||
      verified.result.variations[selectedVariation] !== selected) {
      setApplying(false)
      setApplyReview(false)
      setApplyError('The durable Job/result or selected variation could not be reverified. Review the current result before applying.')
      return
    }
    const outcome = await onApply({
      actorId: before.attempt.actorId, clientId: before.attempt.clientId,
      productId: before.attempt.productId, target: before.attempt.material.target, targetPointer: pointer,
      targetLabel: destination.label, targetValue: before.attempt.material.targetValue,
      draftRevision: before.attempt.material.draftRevision, jobId: before.jobId,
      resultId: result.resultId, variationIndex: selectedVariation,
      variation: selected, job: verified,
    })
    setApplying(false)
    setApplyReview(false)
    requestAnimationFrame(() => reviewApplyRef.current?.focus())
    if (outcome.kind === 'permission_lost') workflow.clear('permission_lost', 'Permission changed. Generated private content was cleared.')
  }

  const dismiss = () => {
    if (!workflow.dismiss()) return
    setSelectedVariation(null)
    setApplyReview(false)
    setApplyError('')
    requestAnimationFrame(() => generateRef.current?.focus())
  }

  const capabilityMessage = capabilities.isLoading
    ? 'Checking AI eligibility…'
    : capabilities.isError
      ? 'AI eligibility is unavailable. Manual editing remains available.'
      : presentation.message

  return <section aria-labelledby="ai-generation-heading" className="space-y-4 rounded-lg border border-gray-300 p-4">
    <div>
      <h3 id="ai-generation-heading" className="font-semibold">AI content generation</h3>
      <p className="mt-1 text-sm text-gray-700">Generate and review durable text. Only a separately confirmed Apply can validate and save one selected field; it never publishes.</p>
    </div>
    <p className="text-sm text-gray-700">{capabilityMessage}</p>
    <AiBackendPreparationButton key={`${user?.id}:${clientId}`} kind="content"
      allowed={hasCreate && hasView && !retainedLocked} onReady={() => capabilities.refetch()} />
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">Generation target
        <select aria-label="Generation target" value={target} disabled={retainedLocked} onChange={(event) => setTarget(event.target.value as AiGenerationTarget)} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">
          {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm font-medium">Tone
        <select aria-label="Tone" value={tone} disabled={retainedLocked} onChange={(event) => setTone(event.target.value as AiContentTone | '')} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">
          <option value="">No tone specified</option><option value="professional">Professional</option><option value="casual">Casual</option><option value="persuasive">Persuasive</option><option value="informative">Informative</option><option value="friendly">Friendly</option><option value="technical">Technical</option>
        </select>
      </label>
      <label className="min-w-0 text-sm font-medium">Apply destination
        <select aria-label="Apply destination" value={targetPointer} disabled={retainedLocked || target === 'image_prompt'} onChange={(event) => setTargetPointer(event.target.value)} aria-describedby="ai-destination-help" className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">
          <option value="">{target === 'image_prompt' ? 'Image prompts cannot be applied' : 'Select one field'}</option>
          {applyTargets.map((option) => <option key={option.pointer} value={option.pointer}>{option.label}</option>)}
        </select>
        <span id="ai-destination-help" className="mt-1 block text-xs font-normal text-gray-600">Generated prose can replace only this scalar text field after Job, permission, value and revision rechecks.</span>
      </label>
      <label className="min-w-0 text-sm font-medium">Target audience
        <input value={targetAudience} maxLength={2000} disabled={retainedLocked} onChange={(event) => setTargetAudience(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50" />
      </label>
      <label className="min-w-0 text-sm font-medium">Variations
        <input type="number" min={1} max={10} value={variations} disabled={retainedLocked} onChange={(event) => setVariations(Math.min(10, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50" />
      </label>
    </div>
    <label className="block text-sm font-medium">Instructions
      <textarea value={instructions} maxLength={4000} disabled={retainedLocked} onChange={(event) => setInstructions(event.target.value)} rows={3} className="mt-1 min-h-11 w-full resize-y rounded-md border border-gray-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50" />
    </label>
    <div className="rounded-md bg-gray-50 p-3 text-sm">
      <p className="font-medium">Selected current text</p><p className="mt-1 whitespace-pre-wrap break-words text-gray-700">{currentValue || 'No current text'}</p>
      {rewriteTooShort && <p className="mt-2 text-amber-900">Rewrite requires at least 10 characters of current text.</p>}
    </div>
    <div className="flex flex-wrap gap-3">
      <button ref={generateRef} type="button" disabled={!canGenerate} onClick={submit} className="min-h-11 min-w-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50">{workflow.state.phase === 'submitting' ? 'Submitting…' : 'Generate'}</button>
      {workflow.state.phase === 'completed' && <button type="button" disabled aria-describedby="ai-regenerate-gate" className="min-h-11 min-w-11 rounded-md border border-gray-400 px-4 py-2 text-sm font-medium disabled:opacity-60">Regenerate</button>}
      {['admission_unknown', 'rate_limited'].includes(workflow.state.phase) && !workflow.state.jobId && <button type="button" onClick={() => workflow.recover()} disabled={workflow.state.retryAfterUntil !== null && Date.now() < workflow.state.retryAfterUntil} className="min-h-11 min-w-11 rounded-md border border-indigo-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Recover this attempt</button>}
      {workflow.state.jobId && ['delayed', 'rate_limited', 'contract_invalid'].includes(workflow.state.phase) && <button type="button" onClick={() => workflow.checkStatus()} disabled={workflow.state.retryAfterUntil !== null && Date.now() < workflow.state.retryAfterUntil} className="min-h-11 min-w-11 rounded-md border border-indigo-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Check status</button>}
    </div>
    {workflow.state.phase === 'completed' && <p id="ai-regenerate-gate" className="text-sm text-amber-900">Regenerate is unavailable for release until a server-owned pre-submit credit amount or bound is available for an accessible confirmation.</p>}
    {actionable(workflow.state.phase) && workflow.state.message && <div ref={errorRef} tabIndex={-1} role="alert" aria-labelledby="ai-error-heading" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><p id="ai-error-heading" className="font-semibold">Generation status</p><p>{workflow.state.message}</p></div>}
    {!actionable(workflow.state.phase) && <div role="status" aria-live="polite" className="min-h-6 text-sm font-medium text-gray-700">{workflow.state.message}</div>}
    {workflow.state.jobId && <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]"><dt className="font-medium">Job ID</dt><dd className="break-all font-mono">{workflow.state.jobId}</dd><dt className="font-medium">Last checked</dt><dd>{checkedText ?? 'Not checked yet'}</dd>{workflow.state.job?.reservation && <><dt className="font-medium">Quoted credits</dt><dd>{workflow.state.job.reservation.estimatedCredits} abstract credits</dd></>}{workflow.state.job?.reservation?.actualCredits !== null && workflow.state.job?.reservation?.actualCredits !== undefined && <><dt className="font-medium">Committed credits</dt><dd>{workflow.state.job.reservation.actualCredits} abstract credits</dd></>}{workflow.state.job?.attempt?.failureCategory && <><dt className="font-medium">Failure category</dt><dd>{workflow.state.job.attempt.failureCategory.replace(/_/g, ' ')}</dd></>}</dl>}
    {workflow.state.prior?.job.result && <section aria-labelledby="ai-prior-result-heading" className="space-y-2 rounded-md border border-gray-300 bg-gray-50 p-3 text-sm"><h4 id="ai-prior-result-heading" className="font-semibold">Prior completed result retained</h4><p>Job <span className="break-all font-mono">{workflow.state.prior.jobId}</span></p><ol className="space-y-2">{workflow.state.prior.job.result.variations.map((variation, index) => <li key={`${workflow.state.prior!.job.result!.resultId}:${index}`} className="whitespace-pre-wrap break-words"><span className="font-medium">Variation {index + 1}:</span> {variation}</li>)}</ol></section>}
    {attempt && workflow.state.job?.result && <><ProductContentPreview attempt={attempt} job={workflow.state.job} draftMoved={draftMoved} selectedIndex={selectedVariation} onSelect={(index) => { setSelectedVariation(index); setApplyReview(false); setApplyError('') }} />
      <div className="flex flex-wrap gap-3">
        {attempt.material.targetPointer && attempt.material.target !== 'image_prompt' && <button id="ai-review-apply" ref={reviewApplyRef} type="button" disabled={selectedVariation === null || dirty || !hasView || !hasProductView || !hasProductUpdate || applying || applyPending} onClick={() => setApplyReview(true)} className="min-h-11 min-w-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50">Review Apply</button>}
        <button type="button" disabled={applying || applyPending} onClick={dismiss} className="min-h-11 min-w-11 rounded-md border border-gray-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Dismiss preview</button>
      </div>
      {dirty && <p className="text-sm text-amber-900">Save or resolve unrelated working-draft edits before Apply so they are not silently committed.</p>}
      {!hasProductView || !hasProductUpdate || !hasView ? <p role="alert" className="text-sm text-amber-900">Apply requires ai:view, products:view and products:update permissions.</p> : null}
      {applyError && <div role="alert" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{applyError}</div>}
      {applyReview && selectedVariation !== null && attempt.material.targetPointer && <section aria-labelledby="ai-apply-review-heading" className="space-y-3 rounded-md border border-indigo-400 bg-white p-4"><h4 id="ai-apply-review-heading" className="font-semibold">Confirm Apply</h4><dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]"><dt className="font-medium">Client</dt><dd className="break-all">{clientId}</dd><dt className="font-medium">Product</dt><dd>{product.name}</dd><dt className="font-medium">Destination</dt><dd>{aiApplyTargets(working, attempt.material.target).find((item) => item.pointer === attempt.material.targetPointer)?.label ?? attempt.material.targetPointer}</dd><dt className="font-medium">Current value at generation</dt><dd className="whitespace-pre-wrap break-words">{attempt.material.targetValue || 'No current text'}</dd><dt className="font-medium">Selected variation</dt><dd className="whitespace-pre-wrap break-words">{workflow.state.job.result.variations[selectedVariation]}</dd></dl><p className="text-sm text-gray-700">Apply will recheck this durable Job and the current draft, validate the entire merged draft, and save one field. It will not publish or debit credits.</p><div className="flex flex-wrap gap-3"><button type="button" disabled={applying || applyPending} onClick={() => void confirmApply()} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">{applying || applyPending ? 'Applying…' : 'Confirm Apply'}</button><button id="ai-cancel-apply" type="button" disabled={applying || applyPending} onClick={() => { setApplyReview(false); requestAnimationFrame(() => reviewApplyRef.current?.focus()) }} className="min-h-11 rounded-md border border-gray-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Cancel Apply</button></div></section>}
    </>}
  </section>
}
