import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { BillingLedgerContractError } from '../../api/billingApi'
import { LedgerFilters } from '../../components/billing/LedgerFilters'
import { LedgerResults } from '../../components/billing/LedgerResults'
import { LedgerExportPanel } from '../../components/billing/LedgerExportPanel'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Breadcrumbs, EmptyState, ErrorDisplay, Forbidden, LoadingSpinner } from '../../components/shared'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'
import {
  billingLedgerKeys,
  cancelAndRemoveBillingLedger,
  clearPrivateBillingQueries,
  useBillingLedger,
} from '../../queries/billingQueries'
import type { BillingLedgerFilters } from '../../types/billing'

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error ? (error as ApiError).status : undefined
}

function ledgerBreadcrumbs(clientId: string) {
  return [
    { label: 'Billing', href: `/billing/clients/${clientId}/account` },
    { label: 'Ledger history' },
    { label: `Selected Client ${clientId}` },
  ]
}

function LedgerPageFrame({ clientId, children, headingRef }: {
  clientId: string
  children: React.ReactNode
  headingRef?: React.RefObject<HTMLHeadingElement | null>
}) {
  return (
    <div className="mx-auto min-w-0 max-w-7xl break-words">
      <Breadcrumbs items={ledgerBreadcrumbs(clientId)} />
      <BillingWorkspaceNav clientId={clientId} />
      <div className="mb-6 min-w-0">
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-2xl font-bold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Ledger history</h1>
        <p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p>
      </div>
      {children}
    </div>
  )
}

function CanonicalLedgerPage({ clientId }: { clientId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const endRef = useRef<HTMLParagraphElement>(null)
  const finalLoadRequested = useRef(false)
  const previousPageCount = useRef(0)
  const queryClient = useQueryClient()
  const [view, setView] = useState<{
    clientId: string
    filters: BillingLedgerFilters
    traversalId: number
  }>({ clientId, filters: {}, traversalId: 1 })
  const filters = view.clientId === clientId ? view.filters : {}
  const traversalId = view.clientId === clientId ? view.traversalId : 1
  const [transitionBusy, setTransitionBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [exportPermissionDenied, setExportPermissionDenied] = useState(false)
  const query = useBillingLedger(clientId, filters, traversalId)
  const filtersActive = Object.keys(filters).length > 0
  const rowsPresent = query.items.length > 0
  const status = errorStatus(query.error)

  useEffect(() => { headingRef.current?.focus() }, [clientId])

  useLayoutEffect(() => {
    if (view.clientId !== clientId) {
      setView({ clientId, filters: {}, traversalId: view.traversalId })
    }
  }, [clientId, view.clientId, view.traversalId])

  const startTraversal = useCallback(async (nextFilters: BillingLedgerFilters, message: string) => {
    setTransitionBusy(true)
    setAnnouncement(message)
    try {
      await cancelAndRemoveBillingLedger(queryClient, billingLedgerKeys.client(clientId))
    } finally {
      setTransitionBusy(false)
    }
    setView((current) => ({
      clientId,
      filters: nextFilters,
      traversalId: current.traversalId + 1,
    }))
  }, [clientId, queryClient])

  const clearFilters = useCallback(() => {
    document.getElementById('ledger-filter-heading')?.focus()
    void startTraversal({}, 'Filters cleared. Loading a fresh ledger snapshot.')
  }, [startTraversal])

  useEffect(() => {
    const pageCount = query.data?.pages.length ?? 0
    if (!query.isFetching && pageCount > 0) {
      const verb = previousPageCount.current > 0 && pageCount > previousPageCount.current ? 'loaded' : 'found'
      setAnnouncement(`${query.items.length} ledger operations ${verb}. Results snapshot as of ${query.asOf}.`)
      previousPageCount.current = pageCount
    }
  }, [query.asOf, query.data?.pages.length, query.isFetching, query.items.length])

  useEffect(() => {
    if (finalLoadRequested.current && !query.isFetchingNextPage && !query.hasNextPage && rowsPresent) {
      finalLoadRequested.current = false
      endRef.current?.focus()
      setAnnouncement('End of ledger results.')
    }
  }, [query.hasNextPage, query.isFetchingNextPage, rowsPresent])

  const loadMore = async () => {
    finalLoadRequested.current = true
    setAnnouncement('Loading more ledger operations.')
    await query.loadMore()
  }

  const initialError = query.isError && !rowsPresent
  const laterError = query.isFetchNextPageError && rowsPresent
  const continuationInvalid = laterError && status === 400
  const durableContractFailure = query.error instanceof BillingLedgerContractError
  const denyExportScope = useCallback(() => setExportPermissionDenied(true), [])

  if (exportPermissionDenied) {
    return <LedgerPageFrame clientId={clientId} headingRef={headingRef}><Forbidden message="The server denied access to this private Billing scope. Prior ledger and export details were removed." /></LedgerPageFrame>
  }

  return (
    <LedgerPageFrame clientId={clientId} headingRef={headingRef}>
      <LedgerFilters appliedFiltersActive={filtersActive} busy={transitionBusy || query.isPending} onApply={(nextFilters) => void startTraversal(nextFilters, 'Filters applied. Loading a fresh ledger snapshot.')} onClear={clearFilters} />
      <LedgerExportPanel clientId={clientId} filters={filters} onPermissionDenied={denyExportScope} />
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

      {query.isPending && !rowsPresent && <LoadingSpinner message="Loading ledger operations…" />}
      {initialError && status === 403 && <Forbidden message="The server denied Billing ledger access for this Client." />}
      {initialError && status === 401 && <ErrorDisplay message="Session ended" detail="Sign in again to request this private ledger." />}
      {initialError && durableContractFailure && <ErrorDisplay message="Ledger unavailable" detail="The server response did not match the Billing ledger contract. No ledger rows have been displayed." onRetry={() => void startTraversal(filters, 'Starting a fresh ledger request.')} />}
      {initialError && status === 400 && <ErrorDisplay message="Ledger filters were rejected" detail="The server rejected the applied values. Adjust the filters and apply them again." />}
      {initialError && status !== 400 && status !== 401 && status !== 403 && !durableContractFailure && <ErrorDisplay message="Ledger unavailable" detail="The ledger could not be loaded. Try again; no balance has been inferred." onRetry={() => void startTraversal(filters, 'Retrying with a fresh ledger snapshot.')} />}

      {!query.isPending && !initialError && !rowsPresent && !filtersActive && <EmptyState title="No ledger operations" description="No immutable credit operations exist for this authorized Client scope." />}
      {!query.isPending && !initialError && !rowsPresent && filtersActive && (
        <section role="status" aria-labelledby="no-ledger-matches" className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 id="no-ledger-matches" className="text-lg font-semibold text-gray-950">No ledger operations match these filters</h2>
          <p className="mt-2 text-sm text-gray-600">The Client scope remains selected and the applied filters are preserved.</p>
          <button type="button" onClick={clearFilters} className="mt-4 min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Clear filters</button>
        </section>
      )}

      {rowsPresent && (
        <>
          <div role="status" className="state-indicator mb-4 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
            <p>Results snapshot as of <time dateTime={query.asOf}>{query.asOf ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(query.asOf)) : ''}</time>.</p>
            <p className="mt-1">Rows are shown newest first in server order. Signed credits show the available-credit effect; “Owned balance after” is authoritative after that operation and is not necessarily the current balance.</p>
          </div>
          {(query.isStale || laterError) && (
            <div role="status" className="state-indicator mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              This view may be stale. Displayed rows remain tied to the original results snapshot.
              <button type="button" onClick={() => void startTraversal(filters, 'Refreshing from a fresh ledger snapshot.')} className="ml-2 min-h-11 rounded-md border border-amber-700 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Refresh</button>
            </div>
          )}
          <LedgerResults items={query.items} />
          {laterError && (
            <div role="alert" className="state-indicator mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950">
              <p className="font-semibold">{continuationInvalid ? 'This ledger view can no longer be continued' : 'More ledger operations could not be loaded'}</p>
              <p className="mt-1">The already validated rows above remain tied to this results snapshot.</p>
              {continuationInvalid ? <button type="button" onClick={() => void startTraversal(filters, 'Starting a fresh ledger snapshot.')} className="mt-3 min-h-11 rounded-md bg-red-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Start fresh</button> : <button type="button" onClick={() => void loadMore()} className="mt-3 min-h-11 rounded-md bg-red-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Retry loading more</button>}
            </div>
          )}
          {!laterError && query.hasNextPage && (
            <div className="mt-5">
              <button type="button" onClick={() => void loadMore()} disabled={query.isFetchingNextPage} aria-describedby="ledger-pagination-status" className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{query.isFetchingNextPage ? 'Loading more…' : 'Load more'}</button>
              <p id="ledger-pagination-status" role="status" className="mt-2 text-sm text-gray-600">{query.isFetchingNextPage ? 'Loading the next cursor page.' : 'More results are available from this snapshot.'}</p>
            </div>
          )}
          {!laterError && !query.hasNextPage && <p ref={endRef} tabIndex={-1} role="status" className="state-indicator mt-5 rounded-md border border-gray-300 bg-gray-50 p-3 text-sm font-medium text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">End of ledger results.</p>}
        </>
      )}
    </LedgerPageFrame>
  )
}

function PermissionAwareLedgerPage({ clientId }: { clientId: string }) {
  const { hasPermission } = useAuth()
  const hasBillingPermission = hasPermission('billing:view')
  const previouslyAllowed = useRef(hasBillingPermission)
  const [permissionLost, setPermissionLost] = useState(false)
  const queryClient = useQueryClient()

  useLayoutEffect(() => {
    if (previouslyAllowed.current && !hasBillingPermission) {
      void clearPrivateBillingQueries(queryClient)
      setPermissionLost(true)
    }
    previouslyAllowed.current = hasBillingPermission
  }, [hasBillingPermission, queryClient])

  return permissionLost ? <LedgerPageFrame clientId={clientId}><Forbidden message="Billing permission is no longer available. Private ledger rows were removed." /></LedgerPageFrame> : <CanonicalLedgerPage clientId={clientId} />
}

export function BillingLedgerBoundaryPage() {
  const { clientId: routeClientId } = useParams()
  const clientId = canonicalizeGuid(routeClientId)
  if (!clientId) return <EmptyState title="Client context unavailable" description="A valid Client URL is required for the Billing workspace." />
  if (routeClientId !== clientId) return <Navigate to={`/billing/clients/${clientId}/ledger`} replace />
  return <PermissionAwareLedgerPage clientId={clientId} />
}
