import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { validateProductContent, type ContractIssue, type ContractTarget } from '../../contracts/product-content/validator'
import { createUuidV7 } from '../../lib/uuidV7'
import {
  useProduct,
  useProductContent,
  usePublishProductContent,
  useSaveProductDraft,
  useUpdateProduct,
} from '../../queries/productQueries'
import type {
  Product,
  ProductContentEnvelope,
  ProductContentValidationIssue,
  ProductContentV1,
} from '../../types/content'
import { Badge } from '../shared/Badge'
import { Modal } from '../shared/Modal'
import { ProductContentFields } from './ProductContentFields'
import { ProductErrorSummary } from './ProductErrorSummary'
import { cloneProductContent, issueMessage, selectEditorContent } from './productEditorModel'

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

export function ProductEditorModal({ clientId, product, onClose }: ProductEditorModalProps) {
  const productId = product?.id ?? ''
  const detailQuery = useProduct(clientId, productId)
  const contentQuery = useProductContent(clientId, productId)
  const saveDraft = useSaveProductDraft(clientId, productId)
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
  const initializedKey = useRef('')
  const generation = useRef(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const identityOperationId = useRef(createUuidV7())
  const lifecycleOperationId = useRef(createUuidV7())

  const editorKey = product ? `${clientId}:${product.id}` : ''
  const pending = saveDraft.isPending || publish.isPending || updateProduct.isPending
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
    {detailError ? <div role="alert" className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"><p>{commandError(detailError)}</p><button type="button" onClick={() => void Promise.all([detailQuery.refetch(), contentQuery.refetch()])} className="min-h-11 rounded-md border border-red-400 px-3 font-medium">Retry loading product</button></div> : detailQuery.isLoading || contentQuery.isLoading || !working || !currentProduct || !authoritativeContent ? <p role="status" className="text-sm text-gray-600">Loading product editor…</p> : <div className="space-y-5">
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
      <div aria-live="polite" role="status" className="min-h-6 text-sm font-medium text-gray-700">{pending ? saveDraft.isPending ? 'Saving draft…' : publish.isPending ? 'Publishing…' : 'Updating product…' : statusText}</div>
      <ProductContentFields value={working} errors={validationErrors} disabled={pending} onChange={onContentChange} onBlur={onFieldBlur} />
    </div>}
  </Modal>
}
