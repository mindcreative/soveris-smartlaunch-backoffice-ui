import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiError } from '../../api/apiClient'
import { useAuth } from '../../hooks/useAuth'
import { useProducts } from '../../queries/productQueries'
import type { Product, ProductFilters } from '../../types/content'
import { ProductCreateModal } from '../../components/products/ProductCreateModal'
import { ProductEditorModal } from '../../components/products/ProductEditorModal'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { ErrorDisplay, Forbidden } from '../../components/shared/ErrorDisplay'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

function ProductBadges({ product }: { product: Product }) {
  return <div className="flex flex-wrap gap-2"><Badge variant={product.status === 'active' ? 'success' : 'neutral'}>{product.status === 'active' ? 'Active' : 'Archived'}</Badge><Badge variant={product.publicationStatus === 'published' ? 'success' : 'info'}>{product.publicationStatus === 'published' ? 'Published' : 'Unpublished'}</Badge><Badge variant={product.completeness.isComplete ? 'success' : 'warning'}>{product.completeness.isComplete ? 'Complete' : 'Incomplete'}</Badge></div>
}

function ProductDetails({ product }: { product: Product }) {
  return <><ProductBadges product={product} /><p className="mt-2 text-xs text-gray-600">Product revision {product.revision} · Live revision {product.contentRevision} · Draft revision {product.draftRevision}</p><p className="mt-1 break-all text-xs text-gray-600">{product.canonicalUrl ?? 'Canonical URL unavailable'}</p></>
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
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProductFilters['status']>('all')
  const [publication, setPublication] = useState<ProductFilters['publication']>('all')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const filters = useMemo<ProductFilters>(() => ({ page, pageSize: 20, status, publication, ...(search.trim() && { search: search.trim() }) }), [page, publication, search, status])
  const query = useProducts(canView ? clientId : '', filters)

  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => { setCreateOpen(false); setSelectedProduct(null) }, [clientId, canView, canCreate, canUpdate])

  if (!canView || !clientId) return <Forbidden message="You do not have permission to view products for this Client." />
  const failure = listError(query.error)
  if (query.error && failure.denied) return <Forbidden message={failure.message} />
  const products = query.data?.items ?? []

  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Products</h1><p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p></div>{canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2">Create product</button>}</div>
    <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <label className="min-w-0 flex-1 text-sm font-medium text-gray-900">Search products<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" /></label>
      <label className="text-sm font-medium text-gray-900">Lifecycle<select value={status} onChange={(event) => { setStatus(event.target.value as ProductFilters['status']); setPage(1) }} className="mt-1 block min-h-11 rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
      <label className="text-sm font-medium text-gray-900">Publication<select value={publication} onChange={(event) => { setPublication(event.target.value as ProductFilters['publication']); setPage(1) }} className="mt-1 block min-h-11 rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><option value="all">All</option><option value="draft">Unpublished</option><option value="published">Published</option></select></label>
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="min-h-11 self-end rounded-md border border-gray-300 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50">{query.isFetching ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {query.isLoading ? <div className="flex justify-center py-12"><LoadingSpinner size="lg" message="Loading products…" /></div> : query.error ? <ErrorDisplay message="Products unavailable" detail={failure.message} onRetry={() => void query.refetch()} /> : products.length === 0 ? <EmptyState title="No products found" description={search ? 'No products match the current filters.' : 'This Client has no products yet.'} actionLabel={canCreate ? 'Create product' : undefined} onAction={canCreate ? () => setCreateOpen(true) : undefined} /> : <>
      {query.isFetching && <p role="status" className="text-sm text-gray-600">Refreshing products…</p>}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block"><table className="w-full"><caption className="sr-only">Products for selected Client</caption><thead className="bg-gray-50"><tr><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Product</th><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">State</th><th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Revisions and URL</th><th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-600">Action</th></tr></thead><tbody className="divide-y divide-gray-200">{products.map((product) => <tr key={product.id}><th scope="row" className="px-4 py-4 text-left"><span className="block font-medium text-gray-950">{product.name}</span><code className="text-xs text-gray-600">{product.slug}</code></th><td className="px-4 py-4"><ProductBadges product={product} /></td><td className="px-4 py-4"><p className="text-xs text-gray-600">Product {product.revision} · Live {product.contentRevision} · Draft {product.draftRevision}</p><p className="mt-1 max-w-xs break-all text-xs text-gray-600">{product.canonicalUrl ?? 'Canonical URL unavailable'}</p></td><td className="px-4 py-4 text-right">{canUpdate && <button type="button" onClick={() => setSelectedProduct(product)} className="min-h-11 rounded-md px-3 text-sm font-medium text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Edit {product.name}</button>}</td></tr>)}</tbody></table></div>
      <ul aria-label="Products for selected Client" className="space-y-3 md:hidden">{products.map((product) => <li key={product.id} className="rounded-lg border border-gray-200 bg-white p-4"><h2 className="font-medium text-gray-950">{product.name}</h2><code className="text-xs text-gray-600">{product.slug}</code><ProductDetails product={product} />{canUpdate && <button type="button" onClick={() => setSelectedProduct(product)} className="mt-3 min-h-11 rounded-md border border-indigo-300 px-3 text-sm font-medium text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Edit {product.name}</button>}</li>)}</ul>
      {(query.data?.totalPages ?? 1) > 1 && <nav aria-label="Product pages" className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium disabled:opacity-50">Previous page</button><p className="text-sm text-gray-700">Page {query.data?.page ?? page} of {query.data?.totalPages}</p><button type="button" disabled={page >= (query.data?.totalPages ?? 1) || query.isFetching} onClick={() => setPage((value) => value + 1)} className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium disabled:opacity-50">Next page</button></nav>}
    </>}
    <ProductCreateModal clientId={clientId} isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(product) => { setCreateOpen(false); setSelectedProduct(product) }} />
    <ProductEditorModal clientId={clientId} product={selectedProduct} onClose={() => setSelectedProduct(null)} />
  </div>
}
