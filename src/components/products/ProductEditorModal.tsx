import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { validateProductContent, type ContractIssue, type ContractTarget } from '../../contracts/product-content/validator'
import { useAuth } from '../../hooks/useAuth'
import { createUuidV7 } from '../../lib/uuidV7'
import { useProductImageUploads } from '../../queries/productImageQueries'
import {
  useProduct,
  useProductContent,
  usePublishProductContent,
  useSaveProductDraft,
  useUpdateProduct,
  useValidateProductContent,
} from '../../queries/productQueries'
import type {
  Product,
  ProductContentEnvelope,
  ProductContentValidationIssue,
  ProductContentV1,
} from '../../types/content'
import type { CompletedProductImageUpload } from '../../types/productImages'
import { Badge } from '../shared/Badge'
import { Modal } from '../shared/Modal'
import { ProductContentFields } from './ProductContentFields'
import { ProductAiGenerationPanel } from './ProductAiGenerationPanel'
import { ProductErrorSummary } from './ProductErrorSummary'
import { aiApplyTargets, mergeAiVariation, readAiScalar, type AiApplyOutcome, type VerifiedAiApplySelection } from './productAiApply'
import { cloneProductContent, issueMessage, pointerToFieldId, selectEditorContent } from './productEditorModel'

interface ProductEditorModalProps {
  clientId: string
  product: Product | null
  onClose: () => void
}

interface ServerCandidate {
  product: Product
  content: ProductContentEnvelope
}

function issues(values: ContractIssue[]): ProductContentValidationIssue[] {
  return values.map((issue) => ({ ...issue, message: issueMessage(issue) }))
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function commandError(error: unknown): string {
  const apiError = error as ApiError | undefined
  if (apiError?.status === 401 || apiError?.status === 403 || apiError?.code === 'insufficient_permissions') {
    return 'Your permission to change this product is no longer available.'
  }
  if (apiError?.status === 404) return 'This product or Client is no longer available.'
  if (apiError?.status === 413) return 'This draft is larger than the server accepts. Shorten it without losing your local edits.'
  if (apiError?.code === 'product_slug_conflict') return 'That slug is already used by another product for this Client.'
  if (apiError?.code === 'product_no_change') return 'The product already has the requested identity and lifecycle state.'
  if (apiError?.code === 'content_no_change') return 'The retained draft already matches the published content.'
  if (apiError?.status === 409 || apiError?.code?.includes('conflict') || apiError?.code?.includes('stale')) {
    return 'The server has a newer revision. Review it before choosing which version to keep.'
  }
  if (apiError?.status === 503 || apiError?.code === 'configuration_unavailable') {
    return 'A required service is temporarily unavailable. Your edits are still here.'
  }
  if (apiError?.code === 'limit_reached' || apiError?.code === 'quota_exceeded') {
    return 'This Client cannot publish another product under its current product limit.'
  }
  if (apiError?.code === 'NETWORK_ERROR') {
    return 'The result is uncertain because the network request failed. Refresh and review before retrying.'
  }
  return apiError?.message || 'The command could not be completed. Your edits are still here.'
}

function setImageSource(content: ProductContentV1, pointer: string, source: string): boolean {
  if (pointer === '/hero/backgroundImage') {
    content.hero.backgroundImage.src = source
    return true
  }
  const match = /^\/features\/items\/(\d+)\/image$/.exec(pointer)
  if (!match || !content.features) return false
  const image = content.features.items[Number(match[1])]?.image
  if (!image) return false
  image.src = source
  return true
}

function imagePointerForSource(pointer: string): string | null {
  if (pointer === '/hero/backgroundImage/src') return '/hero/backgroundImage'
  const match = /^(\/features\/items\/\d+\/image)\/src$/.exec(pointer)
  return match?.[1] ?? null
}

export function ProductEditorModal({ clientId, product, onClose }: ProductEditorModalProps) {
  const { user, hasPermission } = useAuth()
  const productId = product?.id ?? ''
  const detailQuery = useProduct(clientId, productId)
  const contentQuery = useProductContent(clientId, productId)
  const saveDraft = useSaveProductDraft(clientId, productId)
  const validateDraft = useValidateProductContent(clientId, productId)
  const publish = usePublishProductContent(clientId, productId)
  const updateProduct = useUpdateProduct(clientId, productId)
  const [authoritativeProduct, setAuthoritativeProduct] = useState<Product | null>(null)
  const [authoritativeContent, setAuthoritativeContent] = useState<ProductContentEnvelope | null>(null)
  const [working, setWorking] = useState<ProductContentV1 | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [validationErrors, setValidationErrors] = useState<ProductContentValidationIssue[]>([])
  const [warningText, setWarningText] = useState<string[]>([])
  const [statusText, setStatusText] = useState('')
  const [commandErrorText, setCommandErrorText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [serverCandidate, setServerCandidate] = useState<ServerCandidate | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const initializedKey = useRef('')
  const generation = useRef(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const identityOperationId = useRef(createUuidV7())
  const lifecycleOperationId = useRef(createUuidV7())

  const onImageCompleted = useCallback((pointer: string, result: CompletedProductImageUpload) => {
    setWorking((current) => {
      if (!current) return current
      const next = cloneProductContent(current)
      return setImageSource(next, pointer, result.asset.url) ? next : current
    })
    setDirty(true)
    setStatusText('Image uploaded into this working copy. Add meaningful alternative text, then save the draft when ready.')
    setCommandErrorText('')
    const altPointer = `${pointer}/alt`
    requestAnimationFrame(() => document.getElementById(pointerToFieldId(altPointer))?.focus())
  }, [])
  const imageUploads = useProductImageUploads(clientId, productId, onImageCompleted)

  const editorKey = product ? `${clientId}:${product.id}` : ''
  const pending = applyBusy || validateDraft.isPending || saveDraft.isPending || publish.isPending || updateProduct.isPending
  const identityValid = Boolean(name.trim() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()))
  const secondaryButton = 'min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50'
  const primaryButton = 'min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50'
  const identityInput = 'mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600'

  useEffect(() => {
    generation.current += 1
    initializedKey.current = ''
    setAuthoritativeProduct(null)
    setAuthoritativeContent(null)
    setWorking(null)
    setValidationErrors([])
    setWarningText([])
    setStatusText('')
    setCommandErrorText('')
    setDirty(false)
    setNeedsReview(false)
    setServerCandidate(null)
    setApplyBusy(false)
    identityOperationId.current = createUuidV7()
    lifecycleOperationId.current = createUuidV7()
  }, [editorKey])

  useEffect(() => {
    if (!editorKey || initializedKey.current === editorKey || !detailQuery.data || !contentQuery.data) return
    initializedKey.current = editorKey
    setAuthoritativeProduct(detailQuery.data)
    setAuthoritativeContent(contentQuery.data)
    setName(detailQuery.data.name)
    setSlug(detailQuery.data.slug)
    setWorking(selectEditorContent(detailQuery.data, contentQuery.data))
  }, [contentQuery.data, detailQuery.data, editorKey])

  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus())

  const validate = useCallback((target: ContractTarget): boolean => {
    if (!working) return false
    const result = validateProductContent(working, target, 1)
    const nextErrors = issues(result.errors)
    setValidationErrors(nextErrors)
    setWarningText(result.warnings.map(issueMessage))
    if (nextErrors.length) focusSummary()
    return result.valid
  }, [working])

  const fail = (error: unknown) => {
    const apiError = error as ApiError | undefined
    if (apiError?.status === 422 && apiError.errors?.length) {
      setValidationErrors(apiError.errors)
      setCommandErrorText('The server found fields that need correction.')
      focusSummary()
      return
    }
    setCommandErrorText(commandError(error))
    if (apiError?.code !== 'product_slug_conflict' && apiError?.code !== 'product_no_change' &&
      apiError?.code !== 'content_no_change' &&
      (apiError?.status === 409 || apiError?.code?.includes('conflict') || apiError?.code?.includes('stale'))) {
      setNeedsReview(true)
    }
  }

  const handleSave = useCallback(async () => {
    if (!working || !authoritativeContent || pending) return
    setCommandErrorText('')
    setStatusText('')
    if (!validate('draft')) return
    const currentGeneration = generation.current
    try {
      const saved = await saveDraft.mutateAsync({
        schemaVersion: 1,
        expectedRevision: authoritativeContent.draft?.revision ?? 0,
        content: cloneProductContent(working),
      })
      if (currentGeneration !== generation.current) return
      setAuthoritativeContent(saved)
      setWorking(selectEditorContent(authoritativeProduct ?? product!, saved))
      setDirty(false)
      setNeedsReview(false)
      setServerCandidate(null)
      setStatusText(`Draft saved at revision ${saved.draft?.revision ?? 0}.`)
    } catch (error) {
      if (currentGeneration === generation.current) fail(error)
    }
  }, [authoritativeContent, authoritativeProduct, pending, product, saveDraft, validate, working])

  const handleApplyGenerated = useCallback(async (selection: VerifiedAiApplySelection): Promise<AiApplyOutcome> => {
    if (!working || !authoritativeContent || !authoritativeProduct || pending || dirty) {
      setCommandErrorText(dirty
        ? 'Save or resolve unrelated working-draft edits before Apply. Nothing was written.'
        : 'Apply is unavailable while another editor action is running.')
      return { kind: 'review' }
    }
    if (!user?.id || selection.actorId !== user.id || selection.clientId !== clientId ||
      selection.productId !== productId || authoritativeProduct.clientId !== clientId ||
      !hasPermission('ai:view') || !hasPermission('products:view') || !hasPermission('products:update') ||
      selection.job.status !== 'completed' || selection.job.guidance.code !== 'complete' ||
      selection.job.guidance.poll || selection.job.guidance.action !== 'view_result' ||
      selection.job.jobId !== selection.jobId || selection.job.result?.resultId !== selection.resultId ||
      (selection.job.submittedByUserId !== null && selection.job.submittedByUserId !== user.id) ||
      selection.job.result.variations[selection.variationIndex] !== selection.variation) {
      setCommandErrorText('Apply authorization, scope, or durable result evidence is no longer valid. Nothing was written.')
      return { kind: 'permission_lost' }
    }

    setApplyBusy(true)
    setCommandErrorText('')
    setStatusText('Rechecking the current product and draft before Apply…')
    const currentGeneration = generation.current
    let mergedForRecovery: ProductContentV1 | null = null
    let expectedRevisionForRecovery: number | null = null
    let draftPutAttempted = false
    try {
      const [detailResult, contentResult] = await Promise.all([detailQuery.refetch(), contentQuery.refetch()])
      if (currentGeneration !== generation.current) return { kind: 'review' }
      if (detailResult.error || contentResult.error || !detailResult.data || !contentResult.data) {
        const error = detailResult.error ?? contentResult.error
        const apiError = error as unknown as ApiError | undefined
        setCommandErrorText(commandError(error))
        return { kind: apiError?.status === 401 || apiError?.status === 403 || apiError?.status === 404 ? 'permission_lost' : 'review' }
      }
      const freshProduct = detailResult.data
      const freshContent = contentResult.data
      if (freshProduct.id !== productId || freshProduct.clientId !== clientId || freshContent.productId !== productId) {
        setCommandErrorText('The selected Client or product changed. Generated private content was cleared and nothing was written.')
        return { kind: 'permission_lost' }
      }
      const freshRevision = freshContent.draft?.revision ?? 0
      const freshDraft = selectEditorContent(freshProduct, freshContent)
      const freshTarget = readAiScalar(freshDraft, selection.targetPointer)
      const targetIsEligible = aiApplyTargets(freshDraft, selection.target).some(({ pointer }) => pointer === selection.targetPointer)
      if (freshRevision !== selection.draftRevision || !targetIsEligible || freshTarget === null || freshTarget !== selection.targetValue) {
        setServerCandidate({ product: freshProduct, content: freshContent })
        setNeedsReview(true)
        setCommandErrorText(`Apply is stale: it captured draft revision ${selection.draftRevision}, the server reports ${freshRevision}, or the selected target changed. Review and reselect before a new Apply.`)
        setStatusText('No generated content was saved.')
        return { kind: 'review' }
      }

      const merged = mergeAiVariation(freshDraft, selection.targetPointer, selection.variation)
      mergedForRecovery = merged
      expectedRevisionForRecovery = freshRevision
      setWorking(merged)
      setDirty(true)
      const local = validateProductContent(merged, 'draft', 1)
      const localErrors = issues(local.errors)
      setValidationErrors(localErrors)
      setWarningText(local.warnings.map(issueMessage))
      if (!local.valid) {
        setCommandErrorText('The merged draft needs correction before it can be saved. The generated change remains in your working copy.')
        focusSummary()
        return { kind: 'review' }
      }

      const serverReport = await validateDraft.mutateAsync({ schemaVersion: 1, content: cloneProductContent(merged), target: 'draft' })
      if (currentGeneration !== generation.current) return { kind: 'review' }
      setWarningText(serverReport.warnings.map((warning) => warning.message))
      if (!serverReport.isValid || serverReport.errors.length > 0) {
        setValidationErrors(serverReport.errors)
        setCommandErrorText('The server found fields that need correction. The merged working copy and selected result were preserved.')
        focusSummary()
        return { kind: 'review' }
      }
      draftPutAttempted = true
      const saved = await saveDraft.mutateAsync({ schemaVersion: 1, expectedRevision: freshRevision, content: cloneProductContent(merged) })
      if (currentGeneration !== generation.current) return { kind: 'review' }
      if (saved.productId !== productId || saved.draft?.schemaVersion !== 1 ||
        saved.draft.revision !== freshRevision + 1 || JSON.stringify(saved.draft.content) !== JSON.stringify(merged)) {
        setNeedsReview(true)
        setCommandErrorText('The save response could not be verified. Your merged working copy and selected result were preserved; review the server version before any retry.')
        return { kind: 'review' }
      }
      setAuthoritativeProduct(freshProduct)
      setAuthoritativeContent(saved)
      setWorking(selectEditorContent(freshProduct, saved))
      setDirty(false)
      setNeedsReview(false)
      setServerCandidate(null)
      setStatusText(`Generated ${selection.targetLabel} applied and draft saved at revision ${saved.draft?.revision ?? 0}. Live content and credits were unchanged.`)
      return { kind: 'saved' }
    } catch (error) {
      if (currentGeneration !== generation.current) return { kind: 'review' }
      const apiError = error as ApiError | undefined
      if (apiError?.status === 422 && apiError.errors?.length) {
        setValidationErrors(apiError.errors)
        setCommandErrorText('The server found fields that need correction. The merged working copy and selected result were preserved.')
        focusSummary()
        return { kind: 'review' }
      }
      if (apiError?.status === 409 || apiError?.code?.includes('stale')) {
        setNeedsReview(true)
        setCommandErrorText(`The draft changed on the server. Current live revision ${apiError.currentRevision ?? 'unknown'}; current draft revision ${apiError.currentDraftRevision ?? 'unknown'}. Review before another Apply.`)
        return { kind: 'review' }
      }
      if (draftPutAttempted && (apiError?.code === 'NETWORK_ERROR' || apiError?.status === 503) && mergedForRecovery && expectedRevisionForRecovery !== null) {
        setStatusText('The Apply save outcome is uncertain. Verifying the authorized draft before any retry…')
        try {
          const verification = await contentQuery.refetch()
          if (currentGeneration === generation.current && verification.data?.draft?.revision === expectedRevisionForRecovery + 1 &&
            JSON.stringify(verification.data.draft.content) === JSON.stringify(mergedForRecovery)) {
            setAuthoritativeContent(verification.data)
            setWorking(verification.data.draft.content)
            setDirty(false)
            setNeedsReview(false)
            setStatusText(`Generated ${selection.targetLabel} was verified at draft revision ${verification.data.draft.revision}. Live content and credits were unchanged.`)
            return { kind: 'saved' }
          }
        } catch {
          // Preserve the merged working copy and require review below.
        }
        setNeedsReview(true)
        setCommandErrorText('The save outcome could not be verified. Your working copy and selected result are preserved; review the server version before any retry.')
        return { kind: 'review' }
      }
      setCommandErrorText(commandError(error))
      return { kind: apiError?.status === 401 || apiError?.status === 403 || apiError?.status === 404 ? 'permission_lost' : 'review' }
    } finally {
      if (currentGeneration === generation.current) setApplyBusy(false)
    }
  }, [authoritativeContent, authoritativeProduct, clientId, contentQuery, detailQuery, dirty, hasPermission, pending, productId, saveDraft, user?.id, validateDraft, working])

  useEffect(() => {
    if (!product) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, product])

  const handlePublish = async () => {
    if (!working || !authoritativeContent || !authoritativeProduct || pending) return
    setCommandErrorText('')
    setStatusText('')
    if (dirty) {
      setCommandErrorText('Save this draft before publishing it. Publishing never auto-saves local edits.')
      return
    }
    if (!validate('publish')) return
    if (!authoritativeContent.draft) {
      setCommandErrorText('Save a validated draft before publishing.')
      return
    }
    const currentGeneration = generation.current
    try {
      const result = await publish.mutateAsync({
        expectedDraftRevision: authoritativeContent.draft.revision,
        expectedRevision: authoritativeContent.revision,
      })
      if (currentGeneration !== generation.current) return
      const nextContent: ProductContentEnvelope = {
        productId: result.productId,
        schemaVersion: result.schemaVersion,
        revision: result.revision,
        content: result.content,
        draft: result.draft,
      }
      setAuthoritativeContent(nextContent)
      setAuthoritativeProduct({
        ...authoritativeProduct,
        publicationStatus: 'published',
        contentSchemaVersion: result.schemaVersion,
        contentRevision: result.revision,
        draftSchemaVersion: result.draft.schemaVersion,
        draftRevision: result.draft.revision,
      })
      setStatusText(`Published live revision ${result.revision}.`)
    } catch (error) {
      if (currentGeneration === generation.current) fail(error)
    }
  }

  const runProductUpdate = async (kind: 'identity' | 'lifecycle') => {
    if (!authoritativeProduct || pending) return
    const operationRef = kind === 'identity' ? identityOperationId : lifecycleOperationId
    const requestName = kind === 'identity' ? name.trim() : authoritativeProduct.name
    const requestSlug = kind === 'identity' ? slug.trim().toLowerCase() : authoritativeProduct.slug
    const nextStatus = kind === 'lifecycle'
      ? authoritativeProduct.status === 'active' ? 'archived' : 'active'
      : authoritativeProduct.status
    if (!requestName || !requestSlug) return
    setCommandErrorText('')
    setStatusText('')
    const currentGeneration = generation.current
    try {
      const updated = await updateProduct.mutateAsync({
        operationId: operationRef.current,
        expectedRevision: authoritativeProduct.revision,
        name: requestName,
        slug: requestSlug,
        status: nextStatus,
      })
      if (currentGeneration !== generation.current) return
      setAuthoritativeProduct(updated)
      setName(updated.name)
      setSlug(updated.slug)
      if (kind === 'identity' && working) {
        const synchronized = cloneProductContent(working)
        synchronized.name = updated.name
        synchronized.slug = updated.slug
        setWorking(synchronized)
        setDirty(true)
      }
      operationRef.current = createUuidV7()
      if (kind === 'lifecycle') imageUploads.clearAll()
      setStatusText(kind === 'identity' ? 'Product identity updated. Save the synchronized content draft when ready.' : `Product ${updated.status}.`)
    } catch (error) {
      if (currentGeneration === generation.current) fail(error)
    }
  }

  const reviewServer = async () => {
    setCommandErrorText('')
    setStatusText('Fetching the latest server revisions for review…')
    const currentGeneration = generation.current
    const [detail, content] = await Promise.all([detailQuery.refetch(), contentQuery.refetch()])
    if (currentGeneration !== generation.current) return
    if (detail.data && content.data) {
      setServerCandidate({ product: detail.data, content: content.data })
      setStatusText('Latest server revisions loaded. Choose which working copy to use.')
    } else {
      setCommandErrorText('The latest server revision could not be loaded. Your local edits are still here.')
    }
  }

  const acceptServer = () => {
    if (!serverCandidate) return
    setAuthoritativeProduct(serverCandidate.product)
    setAuthoritativeContent(serverCandidate.content)
    setWorking(selectEditorContent(serverCandidate.product, serverCandidate.content))
    setName(serverCandidate.product.name)
    setSlug(serverCandidate.product.slug)
    setDirty(false)
    setValidationErrors([])
    setNeedsReview(false)
    setServerCandidate(null)
    identityOperationId.current = createUuidV7()
    lifecycleOperationId.current = createUuidV7()
    imageUploads.clearAll()
    setStatusText('Server version is now the working copy. Review it before the next command.')
  }

  const keepLocal = () => {
    if (!serverCandidate) return
    setAuthoritativeProduct(serverCandidate.product)
    setAuthoritativeContent(serverCandidate.content)
    setNeedsReview(false)
    setServerCandidate(null)
    identityOperationId.current = createUuidV7()
    lifecycleOperationId.current = createUuidV7()
    setStatusText('Local edits kept with fresh revision tokens. Review before issuing a new command.')
  }

  const onContentChange = (next: ProductContentV1, pointer: string) => {
    const editedImage = imagePointerForSource(pointer)
    if (editedImage) imageUploads.cancel(editedImage)
    setWorking(next)
    setDirty(true)
    setStatusText('Unsaved changes.')
    setCommandErrorText('')
    setValidationErrors((current) => current.filter((error) => !overlaps(error.path, pointer)))
  }

  const onFieldBlur = (pointer: string) => {
    if (!working) return
    const next = issues(validateProductContent(working, 'draft', 1).errors)
    setValidationErrors((current) => [
      ...current.filter((error) => !overlaps(error.path, pointer)),
      ...next.filter((error) => overlaps(error.path, pointer)),
    ])
  }

  const detailError = detailQuery.error || contentQuery.error
  const currentProduct = authoritativeProduct ?? product
  const footer = working && currentProduct ? <div className="flex flex-wrap items-center justify-end gap-3">
    <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>Close</button>
    <button type="button" onClick={() => void handleSave()} disabled={pending} className={secondaryButton}>{saveDraft.isPending ? 'Saving draft…' : 'Save draft'}</button>
    <button type="button" onClick={() => void handlePublish()} disabled={pending} className={primaryButton}>{publish.isPending ? 'Publishing…' : currentProduct.publicationStatus === 'published' ? 'Update published' : 'Publish'}</button>
  </div> : undefined

  return <Modal isOpen={Boolean(product)} onClose={onClose} closeDisabled={pending} title={product ? `Edit ${product.name}` : 'Edit product'} size="2xl" footer={footer}>
    {detailError && !working ? <div role="alert" className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"><p>{commandError(detailError)}</p><button type="button" onClick={() => void Promise.all([detailQuery.refetch(), contentQuery.refetch()])} className="min-h-11 rounded-md border border-red-400 px-3 font-medium">Retry loading product</button></div> : !working || !currentProduct || !authoritativeContent ? <p role="status" className="text-sm text-gray-600">Loading product editor…</p> : <div className="space-y-5">
      <section aria-labelledby="product-state-heading" className="rounded-lg bg-gray-50 p-4">
        <h3 id="product-state-heading" className="font-semibold">Product state</h3>
        <div className="mt-2 flex flex-wrap gap-2"><Badge variant={currentProduct.status === 'active' ? 'success' : 'neutral'}>{currentProduct.status === 'active' ? 'Active' : 'Archived'}</Badge><Badge variant={currentProduct.publicationStatus === 'published' ? 'success' : 'info'}>{currentProduct.publicationStatus === 'published' ? 'Published' : 'Unpublished'}</Badge><Badge variant={currentProduct.completeness.isComplete ? 'success' : 'warning'}>{currentProduct.completeness.isComplete ? 'Complete' : 'Incomplete'}</Badge></div>
        <p className="mt-2 text-sm text-gray-700">Product revision {currentProduct.revision} · Live revision {authoritativeContent.revision} · Draft revision {authoritativeContent.draft?.revision ?? 0}</p>
        <p className="mt-1 break-all text-sm text-gray-700">{currentProduct.canonicalUrl ?? 'Canonical URL unavailable until the server can compute one.'}</p>
      </section>

      <section aria-labelledby="identity-heading" className="space-y-3 rounded-lg border border-gray-300 p-4">
        <h3 id="identity-heading" className="font-semibold">Identity and lifecycle</h3>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Product name<input value={name} maxLength={128} required disabled={pending} onChange={(event) => { if (updateProduct.error) { identityOperationId.current = createUuidV7(); updateProduct.reset() } setName(event.target.value) }} className={identityInput} /></label><label className="text-sm font-medium">Product slug<span className="mt-1 block text-xs font-normal text-gray-600">Lowercase letters, numbers and single hyphens.</span><input value={slug} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required disabled={pending} onChange={(event) => { if (updateProduct.error) { identityOperationId.current = createUuidV7(); updateProduct.reset() } setSlug(event.target.value) }} className={identityInput} /></label></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={pending || !identityValid} onClick={() => void runProductUpdate('identity')} className={secondaryButton}>Update identity</button><button type="button" disabled={pending} onClick={() => void runProductUpdate('lifecycle')} className={secondaryButton}>{currentProduct.status === 'active' ? 'Archive product' : 'Reactivate product'}</button></div>
      </section>

      {commandErrorText && <div aria-live="assertive" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{commandErrorText}</div>}
      {needsReview && <div className="space-y-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm"><p>Your working copy has not been replaced.</p>{!serverCandidate ? <button type="button" disabled={pending} onClick={() => void reviewServer()} className="min-h-11 rounded-md border border-amber-600 px-3 font-medium">Refresh and review server version</button> : <div className="flex flex-wrap gap-2"><button type="button" onClick={acceptServer} className="min-h-11 rounded-md border border-amber-600 px-3 font-medium">Use server version</button><button type="button" onClick={keepLocal} className="min-h-11 rounded-md border border-amber-600 px-3 font-medium">Keep local edits</button></div>}</div>}
      <ProductErrorSummary ref={summaryRef} errors={validationErrors} />
      {warningText.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Draft guidance</p><ul className="list-disc pl-5">{warningText.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <div aria-live="polite" role="status" className="min-h-6 text-sm font-medium text-gray-700">{applyBusy || validateDraft.isPending ? 'Applying generated content…' : pending ? saveDraft.isPending ? 'Saving draft…' : publish.isPending ? 'Publishing…' : 'Updating product…' : statusText}</div>
      <ProductAiGenerationPanel clientId={clientId} product={currentProduct} working={working} draftRevision={authoritativeContent.draft?.revision ?? 0} dirty={dirty} applyPending={applyBusy || validateDraft.isPending || saveDraft.isPending} onApply={handleApplyGenerated} />
      <ProductContentFields
        value={working}
        errors={validationErrors}
        disabled={pending}
        onChange={onContentChange}
        onBlur={onFieldBlur}
        imageUploads={imageUploads.uploads}
        onImageUpload={imageUploads.start}
        onImageRetry={(pointer) => void imageUploads.retry(pointer)}
        onImageCancel={imageUploads.cancel}
      />
    </div>}
  </Modal>
}
