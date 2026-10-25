import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { useAuth } from '../../hooks/useAuth'
import { useDomainScope } from '../../queries/domainScope'
import { ProductRemovalHistory, ProductRemovalModal } from '../../components/products/ProductRemovalPanel'
import { useProducts } from '../../queries/productQueries'
import type { Product, ProductFilters } from '../../types/content'
import { ProductCreateModal } from '../../components/products/ProductCreateModal'
import { ProductEditorModal } from '../../components/products/ProductEditorModal'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { ErrorDisplay, Forbidden } from '../../components/shared/ErrorDisplay'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { firstProductHandoff } from '../../account/sessionHandoff'

function ProductBadges({ product }: { product: Product }) {
  return <div className="flex flex-wrap gap-2"><Badge variant={product.status === 'active' ? 'success' : 'neutral'}>{product.status === 'active' ? 'Active' : 'Archived'}</Badge><Badge variant={product.publicationStatus === 'published' ? 'success' : 'info'}>{product.publicationStatus === 'published' ? 'Published' : 'Unpublished'}</Badge><Badge variant={product.completeness.isComplete ? 'success' : 'warning'}>{product.completeness.isComplete ? 'Complete' : 'Incomplete'}</Badge></div>
}

function ProductDetails({ product }: { product: Product }) {
  return <><ProductBadges product={product} /><p className="mt-2 text-xs text-muted">Product revision {product.revision} · Live revision {product.contentRevision} · Draft revision {product.draftRevision}</p><p className="mt-1 break-all text-xs text-muted">{product.canonicalUrl ?? 'Canonical URL unavailable'}</p></>
}

function listError(error: unknown): { denied: boolean; message: string } {
  const apiError = error as ApiError | undefined
  if (apiError?.status === 401 || apiError?.status === 403) return { denied: true, message: 'You no longer have permission to view this Client’s products.' }
  if (apiError?.status === 404) return { denied: true, message: 'The selected Client is unavailable.' }
  return { denied: false, message: apiError?.message || 'Products are temporarily unavailable.' }
}

export default function ProductsPage() {
  const { user, hasPermission } = useAuth()
  const clientId = user?.clientId ?? ''
  const canView = hasPermission('products:view')
  const canCreate = hasPermission('products:create')
  const canUpdate = hasPermission('products:update')
  const canDelete = hasPermission('products:delete')
  const removalScope = useDomainScope()
  const [removalProduct, setRemovalProduct] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProductFilters['status']>('all')
  const [publication, setPublication] = useState<ProductFilters['publication']>('all')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const firstProduct = useRef(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const filters = useMemo<ProductFilters>(() => ({ page, pageSize: 20, status, publication, ...(search.trim() && { search: search.trim() }) }), [page, publication, search, status])
  const query = useProducts(canView ? clientId : '', filters)

  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => { setCreateOpen(false); setSelectedProduct(null) }, [clientId, canView, canCreate, canUpdate])
  useEffect(() => {
    if (!canView || !canCreate) {
      firstProduct.current = false

      return
    }

    if (firstProductHandoff.consume()) {
      firstProduct.current = true
    }

    if (firstProduct.current) {
      setCreateOpen(true)
    }
  }, [clientId, canView, canCreate, user?.sessionId])
  useEffect(() => { setRemovalProduct(null) }, [clientId, canView, canDelete, removalScope.generation])

  if (!canView || !clientId) return <Forbidden message="You do not have permission to view products for this Client." />
  const failure = listError(query.error)
  if (query.error && failure.denied) return <Forbidden message={failure.message} />
  const products = query.data?.items ?? []

  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">Products</h1><p className="mt-1 break-all text-sm text-muted">Selected Client: {clientId}</p></div>{canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="min-h-11 rounded-md bg-primary-solid px-4 py-2 text-sm font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2">Create product</button>}</div>
    <div className="flex flex-wrap gap-3 rounded-lg border border-line bg-surface p-3">
      <label className="min-w-0 flex-1 text-sm font-medium text-foreground">Search products<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className="mt-1 min-h-11 w-full rounded-md border border-control px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
      <label className="text-sm font-medium text-foreground">Lifecycle<select value={status} onChange={(event) => { setStatus(event.target.value as ProductFilters['status']); setPage(1) }} className="mt-1 block min-h-11 rounded-md border border-control px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
      <label className="text-sm font-medium text-foreground">Publication<select value={publication} onChange={(event) => { setPublication(event.target.value as ProductFilters['publication']); setPage(1) }} className="mt-1 block min-h-11 rounded-md border border-control px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><option value="all">All</option><option value="draft">Unpublished</option><option value="published">Published</option></select></label>
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="min-h-11 self-end rounded-md border border-control px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">{query.isFetching ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {query.isLoading ? <div className="flex justify-center py-12"><LoadingSpinner size="lg" message="Loading products…" /></div> : query.error ? <ErrorDisplay message="Products unavailable" detail={failure.message} onRetry={() => void query.refetch()} /> : products.length === 0 ? <EmptyState title="No products found" description={search ? 'No products match the current filters.' : 'This Client has no products yet.'} actionLabel={canCreate ? 'Create product' : undefined} onAction={canCreate ? () => setCreateOpen(true) : undefined} /> : <>
      {query.isFetching && <p role="status" className="text-sm text-muted">Refreshing products…</p>}
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block"><table className="w-full"><caption className="sr-only">Products for selected Client</caption><thead className="bg-subtle"><tr><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted">Product</th><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted">State</th><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted">Revisions and URL</th><th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted">Action</th></tr></thead><tbody className="divide-y divide-line">{products.map((product) => <tr key={product.id}><th scope="row" className="px-4 py-4 text-left"><span className="block font-medium text-foreground">{product.name}</span><code className="text-xs text-muted">{product.slug}</code></th><td className="px-4 py-4"><ProductBadges product={product} /></td><td className="px-4 py-4"><p className="text-xs text-muted">Product {product.revision} · Live {product.contentRevision} · Draft {product.draftRevision}</p><p className="mt-1 max-w-xs break-all text-xs text-muted">{product.canonicalUrl ?? 'Canonical URL unavailable'}</p></td><td className="px-4 py-4 text-right">{canUpdate && <button type="button" onClick={() => setSelectedProduct(product)} className="min-h-11 rounded-md px-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Edit {product.name}</button>}{canDelete && <button type="button" onClick={() => setRemovalProduct(product)} className="min-h-11 rounded-md px-3 text-sm font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Remove {product.name}</button>}</td></tr>)}</tbody></table></div>
      <ul aria-label="Products for selected Client" className="space-y-3 md:hidden">{products.map((product) => <li key={product.id} className="rounded-lg border border-line bg-surface p-4"><h2 className="font-medium text-foreground">{product.name}</h2><code className="text-xs text-muted">{product.slug}</code><ProductDetails product={product} />{canUpdate && <button type="button" onClick={() => setSelectedProduct(product)} className="mt-3 min-h-11 rounded-md border border-primary-line px-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Edit {product.name}</button>}{canDelete && <button type="button" onClick={() => setRemovalProduct(product)} className="mt-3 min-h-11 rounded-md border border-danger-line px-3 text-sm font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Remove {product.name}</button>}</li>)}</ul>
      {(query.data?.totalPages ?? 1) > 1 && <nav aria-label="Product pages" className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-11 rounded-md border border-control px-4 text-sm font-medium disabled:opacity-50">Previous page</button><p className="text-sm text-foreground">Page {query.data?.page ?? page} of {query.data?.totalPages}</p><button type="button" disabled={page >= (query.data?.totalPages ?? 1) || query.isFetching} onClick={() => setPage((value) => value + 1)} className="min-h-11 rounded-md border border-control px-4 text-sm font-medium disabled:opacity-50">Next page</button></nav>}
    </>}
    {canDelete && <ProductRemovalHistory key={`${removalScope.actorId}:${clientId}:${removalScope.generation}`} scope={removalScope} />}
    {canDelete && removalProduct?.clientId === clientId && <ProductRemovalModal key={`${removalScope.actorId}:${clientId}:${removalScope.generation}:${removalProduct.id}`} clientId={clientId} product={removalProduct} onClose={() => setRemovalProduct(null)} onArchive={canUpdate ? (product) => setSelectedProduct(product) : undefined} returnFocusRef={headingRef} />}
    <ProductCreateModal clientId={clientId} isOpen={createOpen} title={firstProduct.current ? 'Create your first product' : undefined} onClose={() => { firstProduct.current = false; setCreateOpen(false) }} onCreated={(product) => { firstProduct.current = false; setCreateOpen(false); setSelectedProduct(product) }} />
    <ProductEditorModal clientId={clientId} product={selectedProduct} onClose={() => setSelectedProduct(null)} />
  </div>
}
