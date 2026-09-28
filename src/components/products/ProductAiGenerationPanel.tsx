import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useClientCapabilities } from '../../queries/billingQueries'
import { useAiContentGeneration } from '../../queries/aiContentQueries'
import type { Product, ProductContentV1 } from '../../types/content'
import type { AiGenerationMaterial, AiGenerationTarget, AiContentTone } from '../../types/aiContent'
import { presentAiContentCapability } from './aiContentCapability'
import { ProductContentPreview } from './ProductContentPreview'

interface ProductAiGenerationPanelProps {
  clientId: string
  product: Product
  working: ProductContentV1
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

export function ProductAiGenerationPanel({ clientId, product, working }: ProductAiGenerationPanelProps) {
  const { user, hasPermission } = useAuth()
  const capabilities = useClientCapabilities(clientId)
  const [target, setTarget] = useState<AiGenerationTarget>('hero')
  const [targetAudience, setTargetAudience] = useState('')
  const [tone, setTone] = useState<AiContentTone | ''>('')
  const [variations, setVariations] = useState(1)
  const [instructions, setInstructions] = useState('')
  const [, setRetryClock] = useState(0)
  const hasCreate = hasPermission('ai:create')
  const hasView = hasPermission('ai:view')
  const presentation = useMemo(() => presentAiContentCapability(capabilities.data, hasCreate, hasView), [capabilities.data, hasCreate, hasView])
  const authorized = Boolean(user?.id && hasCreate && hasView)
  const workflow = useAiContentGeneration({ actorId: user?.id ?? '', clientId, productId: product.id, classification: capabilities.data?.classification ?? 'customer', authorized })
  const errorRef = useRef<HTMLDivElement>(null)
  const lastFocusedPhase = useRef('')
  const currentValue = selectAiCurrentValue(working, target)
  const attempt = workflow.state.attempt
  const draftMoved = Boolean(attempt && selectAiCurrentValue(working, attempt.material.target) !== attempt.material.currentValue)
  const retainedLocked = Boolean(workflow.state.jobId) || ['submitting', 'polling', 'admission_unknown', 'rate_limited', 'completed', 'failed', 'execution_unknown', 'cancelled', 'contract_invalid', 'permission_lost', 'unavailable'].includes(workflow.state.phase)
  const rewriteTooShort = target === 'rewrite' && currentValue.trim().length < 10
  const canGenerate = presentation.eligible && !capabilities.isFetching && !retainedLocked && !rewriteTooShort
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

  const submit = () => {
    const material: AiGenerationMaterial = {
      target, currentValue, productSlug: working.slug || product.slug,
      productName: working.name || product.name, targetAudience: targetAudience.trim(),
      tone: tone || null, variations, instructions: instructions.trim(),
    }
    workflow.generate(material)
  }

  const capabilityMessage = capabilities.isLoading
    ? 'Checking AI eligibility…'
    : capabilities.isError
      ? 'AI eligibility is unavailable. Manual editing remains available.'
      : presentation.message

  return <section aria-labelledby="ai-generation-heading" className="space-y-4 rounded-lg border border-gray-300 p-4">
    <div>
      <h3 id="ai-generation-heading" className="font-semibold">AI content generation</h3>
      <p className="mt-1 text-sm text-gray-700">Generate a read-only comparison. This does not save, publish, or update the working draft.</p>
    </div>
    <p className="text-sm text-gray-700">{capabilityMessage}</p>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">Generation target
        <select value={target} disabled={retainedLocked} onChange={(event) => setTarget(event.target.value as AiGenerationTarget)} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">
          {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm font-medium">Tone
        <select value={tone} disabled={retainedLocked} onChange={(event) => setTone(event.target.value as AiContentTone | '')} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">
          <option value="">No tone specified</option><option value="professional">Professional</option><option value="casual">Casual</option><option value="persuasive">Persuasive</option><option value="informative">Informative</option><option value="friendly">Friendly</option><option value="technical">Technical</option>
        </select>
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
      <button type="button" disabled={!canGenerate} onClick={submit} className="min-h-11 min-w-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50">{workflow.state.phase === 'submitting' ? 'Submitting…' : 'Generate'}</button>
      {['admission_unknown', 'rate_limited'].includes(workflow.state.phase) && !workflow.state.jobId && <button type="button" onClick={() => workflow.recover()} disabled={workflow.state.retryAfterUntil !== null && Date.now() < workflow.state.retryAfterUntil} className="min-h-11 min-w-11 rounded-md border border-indigo-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Recover this attempt</button>}
      {workflow.state.jobId && ['delayed', 'rate_limited', 'contract_invalid'].includes(workflow.state.phase) && <button type="button" onClick={() => workflow.checkStatus()} disabled={workflow.state.retryAfterUntil !== null && Date.now() < workflow.state.retryAfterUntil} className="min-h-11 min-w-11 rounded-md border border-indigo-400 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">Check status</button>}
    </div>
    {actionable(workflow.state.phase) && workflow.state.message && <div ref={errorRef} tabIndex={-1} role="alert" aria-labelledby="ai-error-heading" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><p id="ai-error-heading" className="font-semibold">Generation status</p><p>{workflow.state.message}</p></div>}
    {!actionable(workflow.state.phase) && <div role="status" aria-live="polite" className="min-h-6 text-sm font-medium text-gray-700">{workflow.state.message}</div>}
    {workflow.state.jobId && <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]"><dt className="font-medium">Job ID</dt><dd className="break-all font-mono">{workflow.state.jobId}</dd><dt className="font-medium">Last checked</dt><dd>{checkedText ?? 'Not checked yet'}</dd>{workflow.state.job?.attempt?.failureCategory && <><dt className="font-medium">Failure category</dt><dd>{workflow.state.job.attempt.failureCategory.replace(/_/g, ' ')}</dd></>}</dl>}
    {attempt && workflow.state.job?.result && <ProductContentPreview attempt={attempt} job={workflow.state.job} draftMoved={draftMoved} />}
  </section>
}
