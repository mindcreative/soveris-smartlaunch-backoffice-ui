import { privateObjectUrl, releasePrivateObjectUrl } from '../../auth/authorityEpoch'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getAiImageJob, isCanonicalUuidV7, redeemAiImageResult } from '../../api/aiImageApi'
import { getProductImagePreview } from '../../api/productImageApi'
import type { ApiError } from '../../api/apiClient'
import { useAuth } from '../../hooks/useAuth'
import { createUuidV7 } from '../../lib/uuidV7'
import { useGeneratedProductImageCommands } from '../../queries/generatedProductImageQueries'
import type { AiImageJob } from '../../types/aiImages'
import type { ProductContentV1 } from '../../types/content'
import type { CompletedGeneratedProductImage, GeneratedProductImageScope } from '../../types/generatedProductImages'
import { captureGeneratedImageTarget, sameImageTarget, type GeneratedImageTarget, type VerifiedGeneratedImageSelection } from './productImageApply'
import type { AiApplyOutcome } from './productAiApply'

interface Props {
  clientId: string; productId: string; working: ProductContentV1; draftRevision: number; dirty: boolean; applyPending: boolean
  onApply: (selection: VerifiedGeneratedImageSelection, signal: AbortSignal) => Promise<AiApplyOutcome>
}
const button = 'min-h-11 rounded-md border border-primary-line px-4 py-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
export function ProductGeneratedImagePanel({ clientId, productId, working, draftRevision, dirty, applyPending, onApply }: Props) {
  const { user, hasPermission } = useAuth()
  const allowed = Boolean(user && user.clientId === clientId && hasPermission('products:update') && (hasPermission('ai:view') || hasPermission('audit:view')))
  const commands = useGeneratedProductImageCommands(clientId, productId)
  const [jobId, setJobId] = useState(''); const [pointer, setPointer] = useState('/hero/backgroundImage')
  const [picked, setPicked] = useState<AiImageJob | null>(null)
  const [scope, setScope] = useState<GeneratedProductImageScope | null>(null)
  const [receipt, setReceipt] = useState<CompletedGeneratedProductImage | null>(null)
  const [target, setTarget] = useState<GeneratedImageTarget | null>(null)
  const [revision, setRevision] = useState(0); const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false); const [quotaRejected, setQuotaRejected] = useState(false)
  const [message, setMessage] = useState('Select a completed image Job. Saving an asset and applying it are separate actions.')
  const [error, setError] = useState(''); const [preview, setPreview] = useState<string | null>(null)
  const generation = useRef(0); const controller = useRef<AbortController | null>(null)
  const reference = useRef<string | null>(null); const objectUrl = useRef<string | null>(null)
  const jobInput = useRef<HTMLInputElement>(null); const altInput = useRef<HTMLInputElement>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const errorId = `generated-image-error-${productId}`
  const altError = Boolean(error && /alternative text/i.test(error))
  const sourceError = Boolean(error && /canonical completed image Job ID|current permission is unavailable/i.test(error))
  useEffect(() => { if (error) errorSummary.current?.focus() }, [error])
  const revoke = () => { if (objectUrl.current) releasePrivateObjectUrl(objectUrl.current); objectUrl.current = null; setPreview(null) }
  const clear = () => {
    generation.current += 1; controller.current?.abort(); controller.current = null; reference.current = null; revoke(); commands.clear()
    setPicked(null); setScope(null); setReceipt(null); setTarget(null); setAlt(''); setJobId(''); setPointer('/hero/backgroundImage'); setBusy(false); setError(''); setQuotaRejected(false)
    setMessage('Private image selection cleared. Already accepted work may finish as a private asset.')
  }
  useLayoutEffect(() => { clear(); return () => { generation.current += 1; controller.current?.abort(); reference.current = null
    if (objectUrl.current) releasePrivateObjectUrl(objectUrl.current); commands.clear() } }, [clientId, productId, user?.id, allowed])
  useEffect(() => { const reset = () => clear(); window.addEventListener('auth:refreshed', reset); window.addEventListener('popstate', reset)
    return () => { window.removeEventListener('auth:refreshed', reset); window.removeEventListener('popstate', reset) } })
  useEffect(() => {
    if (!picked?.result || receipt) return
    const duration = Date.parse(picked.result.expiresAt) - Date.now()
    const expire = () => { controller.current?.abort(); reference.current = null; revoke(); setPicked(null); setMessage('The private source expired. A completed asset receipt remains usable.') }
    if (duration <= 0) { expire(); return }
    const timer = window.setTimeout(expire, Math.min(duration, 2147483647)); return () => window.clearTimeout(timer)
  }, [picked?.result?.expiresAt, receipt])
  const failed = (value: unknown) => {
    const problem = value as ApiError
    if ([401, 403, 404].includes(problem.status ?? 0)) { clear(); setError('This image or your current permission is unavailable. Private state was cleared.'); return }
    setQuotaRejected(problem.code === 'storage_limit_exceeded')
    setError(problem.code === 'storage_limit_exceeded' ? 'Product image storage is full. Free capacity, then explicitly start a new attempt.'
      : 'The result could not be confirmed. Check adoption status before continuing the same operation.')
  }
  const select = async () => {
    if (!allowed || busy || !isCanonicalUuidV7(jobId)) { setError('Enter a canonical completed image Job ID.'); jobInput.current?.focus(); return }
    const current = captureGeneratedImageTarget(working, pointer)
    if (!current) { setError('Choose a current image destination.'); return }
    generation.current += 1; const captured = generation.current; controller.current?.abort(); revoke(); reference.current = null
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setReceipt(null); setScope(null)
    setMessage('Checking the completed image and current permission…')
    try {
      const job = await getAiImageJob(clientId, jobId, abort.signal)
      if (captured !== generation.current || abort.signal.aborted) return
      if (job.status !== 'completed' || !job.result || job.targetRole !== current.role || Date.parse(job.result.expiresAt) <= Date.now())
        throw new Error('Choose an available completed image matching this destination.')
      reference.current = job.resultAccess?.reference ?? null
      setPicked({ ...job, resultAccess: null }); setTarget(current); setRevision(draftRevision)
      setScope({ productId, operationId: createUuidV7(), jobId: job.jobId, resultId: job.result.resultId, assetRole: current.role })
      const index = /^\/features\/items\/(\d+)\/image$/.exec(pointer)
      setAlt(current.role === 'hero' ? working.hero.backgroundImage.alt : working.features?.items[Number(index?.[1])]?.image?.alt ?? '')
      setMessage('Completed source verified. Review it, then save a private product asset.'); setQuotaRejected(false)
    } catch (value) { if (captured === generation.current) { failed(value); jobInput.current?.focus() } }
    finally { if (captured === generation.current) setBusy(false) }
  }
  const adopt = async (statusOnly = false, newOperation = false) => {
    if (!scope || busy || !allowed) return
    const captured = generation.current; const selected = newOperation ? { ...scope, operationId: createUuidV7() } : scope
    if (newOperation) { setScope(selected); setQuotaRejected(false) }
    setBusy(true); setError(''); setMessage(statusOnly ? 'Checking saved asset status…' : 'Verifying the source and saving a private product asset…')
    try {
      const result = await commands.execute(selected, statusOnly)
      if (captured !== generation.current) return
      if (result.status === 'completed') { setReceipt(result); reference.current = null; revoke(); setMessage('Asset saved privately. Enter meaningful alternative text and use Apply to save only this image to the draft.'); altInput.current?.focus() }
      else setMessage('Asset processing continues. Check status or explicitly continue the same adoption. Closing does not cancel accepted server work.')
    } catch (value) { if (captured === generation.current) failed(value) }
    finally { if (captured === generation.current) setBusy(false) }
  }
  const view = async () => {
    if (busy || !allowed) return
    const captured = generation.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setBusy(true); setMessage('Loading private image preview…')
    try {
      const blob = receipt ? await getProductImagePreview(productId, receipt.asset.id, abort.signal)
        : picked?.result && reference.current ? await redeemAiImageResult(picked.jobId, reference.current, picked.result.byteSize, abort.signal) : null
      if (captured !== generation.current || abort.signal.aborted) return
      if (!blob || blob.type !== 'image/webp' || blob.size !== (receipt?.asset.byteLength ?? picked?.result?.byteSize)) throw new Error('Preview unavailable.')
      revoke(); objectUrl.current = privateObjectUrl(blob); setPreview(objectUrl.current); setMessage('Private preview loaded.')
    } catch (value) { if (captured === generation.current && !abort.signal.aborted) {
      const status = (value as ApiError).status
      if (status === 404 && !receipt) { reference.current = null; revoke(); setError('The private preview is unavailable. Refresh the completed Job or check the retained adoption status.'); }
      else failed(value)
    } }
    finally { if (captured === generation.current) setBusy(false) }
  }
  const apply = async () => {
    if (!receipt || !target || !user || busy || applyPending || dirty || target.pointer !== pointer || jobId !== receipt.jobId ||
      !sameImageTarget(working, target) || !alt.trim() || [...alt].length > 120) {
      setError(dirty ? 'Save unrelated draft edits, then explicitly recapture this destination with the same saved asset.' : 'Enter meaningful alternative text before Apply.'); altInput.current?.focus(); return
    }
    const captured = generation.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setBusy(true); setMessage('Rechecking the asset, destination and draft revision before Apply…')
    try {
      const result = await onApply({ actorId: user.id, clientId, productId, target, draftRevision: revision, receipt, alt }, abort.signal)
      if (captured !== generation.current) return
      if (result.kind === 'permission_lost') clear()
      else setMessage(result.kind === 'saved' ? 'Image applied and draft saved. Publication remains a separate action.' : 'Apply needs review. The saved asset is retained; correct or recapture the destination before trying again.')
    } catch (value) { if (captured === generation.current && !abort.signal.aborted) failed(value) }
    finally { if (captured === generation.current) setBusy(false) }
  }
  if (!allowed) return null
  return <section aria-labelledby={`generated-image-title-${productId}`} className="min-w-0 space-y-3 rounded-md border border-control p-4">
    <h3 id={`generated-image-title-${productId}`} className="font-semibold">Use a completed generated image</h3>
    <p className="text-sm">Saving an asset does not change this draft. Apply saves the chosen image; publishing is separate. Closing may leave accepted work finishing as a private asset.</p>
    <label className="block">Image destination<select aria-label="Image destination" value={pointer} disabled={busy || applyPending} onChange={e => setPointer(e.target.value)} className="block min-h-11 w-full border p-2">
      <option value="/hero/backgroundImage">Hero background image</option>{working.features?.items.map((item, index) => <option key={index} value={`/features/items/${index}/image`}>Feature {index + 1}: {item.title}</option>)}
    </select></label>
    <label className="block">Completed image Job ID<input ref={jobInput} value={jobId} disabled={busy || applyPending} aria-invalid={sourceError} aria-describedby={sourceError ? errorId : undefined} onChange={e => setJobId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void select() } }} className="block min-h-11 w-full border p-2" /></label>
    <button type="button" className={button} disabled={busy || applyPending} onClick={() => void select()}>Find completed image</button>
    {(picked || receipt || scope) && <>
      <label className="block">Alternative text for generated image<input ref={altInput} value={alt} maxLength={240} aria-invalid={altError} aria-describedby={altError ? errorId : undefined} onChange={e => setAlt(e.target.value)} className="block min-h-11 w-full border p-2" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || (!receipt && (!picked || !reference.current))} onClick={() => void view()}>View private image</button>
        {!receipt && <button type="button" className={button} disabled={busy || quotaRejected} onClick={() => void adopt()}>Save private asset</button>}
        {scope && !receipt && <button type="button" className={button} disabled={busy} onClick={() => void adopt(true)}>Check adoption status</button>}
        {quotaRejected && <button type="button" className={button} disabled={busy} onClick={() => void adopt(false, true)}>Retry with a new operation</button>}
        {receipt && <><button type="button" className={button} disabled={busy || dirty || applyPending} onClick={() => {
          const current = captureGeneratedImageTarget(working, pointer)
          if (current?.role !== receipt.asset.role) { setError('Choose a destination matching the saved image role.'); return }
          setTarget(current); setRevision(draftRevision); setError(''); setMessage('Current destination and draft revision recaptured. The saved asset was reused.')
        }}>Recapture destination</button><button type="button" className={button} disabled={busy || applyPending || dirty || !alt.trim() ||
          target?.pointer !== pointer || jobId !== receipt.jobId || !target || !sameImageTarget(working, target)} onClick={() => void apply()}>Apply generated image</button></>}
        <button type="button" className={button} onClick={() => { clear(); jobInput.current?.focus() }}>Clear image selection</button>
      </div>
    </>}
    <p role="status" aria-live="polite">{message}</p>{error && <div ref={errorSummary} role="alert" tabIndex={-1} aria-label="Generated image needs attention" className="rounded border border-danger-line p-3 focus:outline focus:outline-2 focus:outline-focus">
      <button id={errorId} type="button" className={button} onClick={() => (altError ? altInput : jobInput).current?.focus()}>{error}</button>
    </div>}
    {preview && <img src={preview} alt={alt || 'Private generated image preview'} className="max-h-64 max-w-full object-contain" />}
  </section>
}
