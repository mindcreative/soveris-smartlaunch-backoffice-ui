import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { BillingAdjustmentContractError } from '../../api/billingAdjustmentApi'
import { AdjustmentHistoryFilters } from '../../components/billing/AdjustmentHistoryFilters'
import { AdjustmentHistoryResults } from '../../components/billing/AdjustmentHistoryResults'
import { CreditAdjustmentReversalWorkflow } from '../../components/billing/CreditAdjustmentReversalWorkflow'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Breadcrumbs, EmptyState, ErrorDisplay, Forbidden, LoadingSpinner } from '../../components/shared'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'
import {
  billingAdjustmentKeys,
  cancelAndRemoveBillingAdjustmentHistory,
  clearPrivateBillingQueries,
  useBillingAdjustmentHistory,
} from '../../queries/billingQueries'
import { LocalInstant, localInstantLabel } from '../../timezone/LocalInstant'
import type {
  CreditAdjustmentHistoryFilters,
  CreditAdjustmentHistoryOriginalItem,
} from '../../types/billing'

let traversalSequence = 0
const nextTraversalId = () => ++traversalSequence

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : undefined
}

function serverDateError(error: unknown): { field: 'from' | 'to'; message: string } | null {
  if (errorStatus(error) !== 422) return null
  const code = errorCode(error)
  if (code !== 'local_time_ambiguous' && code !== 'local_time_nonexistent') return null
  const details = (error as ApiError).problemDetails
  const field = details?.field
  if (field !== 'from' && field !== 'to') return null
  return {
    field,
    message: code === 'local_time_ambiguous'
      ? 'Choose a local time that occurs only once in your saved timezone.'
      : 'Choose a local time that exists in your saved timezone.',
  }
}

function historyBreadcrumbs(clientId: string) {
  return [
    { label: 'Billing', href: `/billing/clients/${clientId}/account` },
    { label: 'Adjustment history' },
    { label: `Selected Client ${clientId}` },
  ]
}

function HistoryPageFrame({ clientId, children, headingRef }: {
  clientId: string
  children: React.ReactNode
  headingRef?: React.RefObject<HTMLHeadingElement | null>
}) {
  return (
    <div className="mx-auto min-w-0 max-w-7xl break-words">
      <Breadcrumbs items={historyBreadcrumbs(clientId)} />
      <BillingWorkspaceNav clientId={clientId} />
      <div className="mb-6 min-w-0">
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}
          className="text-2xl font-bold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
          Adjustment history
        </h1>
        <p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p>
      </div>
      {children}
    </div>
  )
}

function CanonicalAdjustmentHistoryPage({ clientId }: { clientId: string }) {
  const { hasPermission, user } = useAuth()
  const canView = hasPermission('billing:view')
  const canAdjust = hasPermission('billing:adjust')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reversalReturnFocusRef = useRef<HTMLElement | null>(null)
  const endRef = useRef<HTMLParagraphElement>(null)
  const finalLoadRequested = useRef(false)
  const previousPageCount = useRef(0)
  const mountGenerationRef = useRef(0)
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<CreditAdjustmentHistoryFilters>({})
  const [traversalId, setTraversalId] = useState(nextTraversalId)
  const [transitionBusy, setTransitionBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [selectedReversal, setSelectedReversal] =
    useState<CreditAdjustmentHistoryOriginalItem | null>(null)
  const query = useBillingAdjustmentHistory(clientId, filters, traversalId)
  const activeKeyRef = useRef(billingAdjustmentKeys.list(clientId, filters, traversalId))
  activeKeyRef.current = billingAdjustmentKeys.list(clientId, filters, traversalId)
  const filtersActive = Object.keys(filters).length > 0
  const rowsPresent = query.items.length > 0
  const status = errorStatus(query.error)
  const code = errorCode(query.error)
  const fieldError = serverDateError(query.error)

  useEffect(() => { headingRef.current?.focus() }, [clientId])

  useEffect(() => {
    const generation = ++mountGenerationRef.current
    return () => {
      queueMicrotask(() => {
        if (mountGenerationRef.current === generation)
          void cancelAndRemoveBillingAdjustmentHistory(queryClient, activeKeyRef.current)
      })
    }
  }, [queryClient])

  const startTraversal = useCallback(async (
    nextFilters: CreditAdjustmentHistoryFilters,
    message: string,
  ) => {
    setTransitionBusy(true)
    setAnnouncement(message)
    const currentKey = billingAdjustmentKeys.list(clientId, filters, traversalId)
    try {
      await cancelAndRemoveBillingAdjustmentHistory(queryClient, currentKey)
    } finally {
      setFilters(nextFilters)
      setTraversalId(nextTraversalId())
      setTransitionBusy(false)
      previousPageCount.current = 0
      finalLoadRequested.current = false
    }
  }, [clientId, filters, queryClient, traversalId])

  const clearFilters = useCallback(() => {
    void startTraversal({}, 'Filters cleared. Loading a fresh adjustment history snapshot.')
  }, [startTraversal])

  useEffect(() => {
    const pageCount = query.data?.pages.length ?? 0
    if (!query.isFetching && pageCount > 0) {
      const verb = previousPageCount.current > 0 && pageCount > previousPageCount.current
        ? 'loaded' : 'found'
      setAnnouncement(`${query.items.length} adjustments ${verb}. Results snapshot as of ${
        query.asOf ? localInstantLabel(query.asOf) : 'unavailable'}.`)
      previousPageCount.current = pageCount
    }
  }, [query.asOf, query.data?.pages.length, query.isFetching, query.items.length])

  useEffect(() => {
    if (finalLoadRequested.current && !query.isFetchingNextPage &&
        !query.hasNextPage && rowsPresent && !query.isFetchNextPageError) {
      finalLoadRequested.current = false
      endRef.current?.focus()
      setAnnouncement('End of adjustment history results.')
    }
  }, [query.hasNextPage, query.isFetchNextPageError, query.isFetchingNextPage, rowsPresent])

  const loadMore = async () => {
    finalLoadRequested.current = true
    setAnnouncement('Loading more adjustment history.')
    await query.loadMore()
  }

  const initialError = query.isError && !rowsPresent
  const laterError = query.isFetchNextPageError && rowsPresent
  const continuationInvalid = laterError && status === 400
  const integrityFailure = query.error instanceof BillingAdjustmentContractError ||
    code === 'credit_adjustment_history_integrity_failure'

  return (
    <HistoryPageFrame clientId={clientId} headingRef={headingRef}>
      <AdjustmentHistoryFilters appliedFiltersActive={filtersActive}
        busy={transitionBusy || query.isPending}
        onApply={(nextFilters) => void startTraversal(
          nextFilters, 'Filters applied. Loading a fresh adjustment history snapshot.')}
        onClear={clearFilters} serverFieldError={fieldError} />
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
      <CreditAdjustmentReversalWorkflow clientId={clientId} actorUserId={user?.id ?? ''}
        canAdjust={canAdjust} canView={canView} selected={selectedReversal}
        returnFocusRef={reversalReturnFocusRef}
        onClose={() => setSelectedReversal(null)}
        onPermissionDenied={() => {
          reversalReturnFocusRef.current = headingRef.current
          setSelectedReversal(null)
          setAnnouncement('Reversal permission is no longer available. Refreshing readable history.')
          void startTraversal(filters, 'Reversal permission changed. Loading fresh adjustment history.')
        }}
        onResolved={(message) => {
          reversalReturnFocusRef.current = headingRef.current
          setAnnouncement(message)
          void startTraversal(filters, `${message} Loading a fresh adjustment history snapshot.`)
        }} />

      {query.isPending && !rowsPresent &&
        <LoadingSpinner message="Loading adjustment history…" />}
      {initialError && status === 403 &&
        <Forbidden message="The server denied adjustment history access for this Client." />}
      {initialError && status === 401 &&
        <ErrorDisplay message="Session ended" detail="Sign in again to request this private adjustment history." />}
      {initialError && status === 409 && code === 'time_zone_not_set' &&
        <ErrorDisplay message="Saved timezone required"
          detail="Contact an administrator to save a timezone before reviewing adjustment history." />}
      {initialError && status === 422 && fieldError &&
        <p role="status" className="state-indicator rounded-md border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
          The selected local time needs attention. The filter draft has been preserved.
        </p>}
      {initialError && status === 400 &&
        <ErrorDisplay message="Adjustment history filters were rejected"
          detail="The server rejected the applied values. Adjust the filters and apply them again." />}
      {initialError && status === 503 && code === 'authorization_dependency_unavailable' &&
        <ErrorDisplay message="Authorization unavailable"
          detail="Access could not be verified. Start a fresh request when authorization is available."
          onRetry={() => void startTraversal(filters, 'Retrying authorization with a fresh request.')} />}
      {initialError && status === 503 && code !== 'authorization_dependency_unavailable' &&
        <ErrorDisplay message="Adjustment history unavailable"
          detail="The history service is temporarily unavailable. Start a fresh request to try again."
          onRetry={() => void startTraversal(filters, 'Retrying with a fresh adjustment history snapshot.')} />}
      {initialError && integrityFailure &&
        <ErrorDisplay message="Adjustment history unavailable"
          detail="The server response did not match the immutable history contract. No rows have been displayed." />}
      {initialError && status !== 400 && status !== 401 && status !== 403 && status !== 409 &&
        status !== 422 && status !== 503 && !integrityFailure &&
        <ErrorDisplay message="Adjustment history unavailable"
          detail="Adjustment history could not be loaded. Start a fresh request to try again."
          onRetry={() => void startTraversal(filters, 'Retrying with a fresh adjustment history snapshot.')} />}

      {!query.isPending && !initialError && !rowsPresent && !filtersActive &&
        <EmptyState title="No adjustment history"
          description="No immutable adjustments exist for this authorized Client scope." />}
      {!query.isPending && !initialError && !rowsPresent && filtersActive &&
        <section role="status" aria-labelledby="no-adjustment-matches"
          className="rounded-lg border border-gray-300 bg-white p-6 text-center">
          <h2 id="no-adjustment-matches" className="text-lg font-semibold text-gray-950">
            No adjustments match these filters
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            The Client scope remains selected and the applied filters are preserved.
          </p>
          <button type="button" onClick={clearFilters}
            className="mt-4 min-h-11 rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
            Clear filters
          </button>
        </section>}

      {rowsPresent && <>
        <div role="status"
          className="state-indicator mb-4 rounded-md border border-blue-400 bg-blue-50 p-3 text-sm text-blue-950">
          <p>Results snapshot as of {query.asOf && <LocalInstant value={query.asOf} />}.</p>
          <p className="mt-1">Rows are shown newest first in authoritative server order.</p>
        </div>
        {(query.isStaleSnapshot || laterError) &&
          <div role="status"
            className="state-indicator mb-4 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
            This adjustment history may be stale. Displayed rows remain tied to the original results snapshot.
            <button type="button"
              onClick={() => void startTraversal(filters, 'Refreshing from a fresh adjustment history snapshot.')}
              className="ml-2 min-h-11 rounded-md border border-amber-800 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
              Refresh
            </button>
          </div>}
        <AdjustmentHistoryResults items={query.items} canAdjust={canAdjust}
          onReviewReversal={(item, trigger) => {
            reversalReturnFocusRef.current = trigger
            setSelectedReversal(item)
            setAnnouncement(`Loading fresh reversal evidence for original adjustment ${item.adjustmentId}.`)
          }} />
        {laterError &&
          <div role="alert"
            className="state-indicator mt-4 rounded-md border border-red-500 bg-red-50 p-4 text-sm text-red-950">
            <p className="font-semibold">{continuationInvalid
              ? 'This adjustment history can no longer be continued'
              : 'More adjustment history could not be loaded'}</p>
            <p className="mt-1">The validated rows above remain tied to this results snapshot.</p>
            {continuationInvalid
              ? <button type="button"
                  onClick={() => void startTraversal(filters, 'Starting a fresh adjustment history snapshot.')}
                  className="mt-3 min-h-11 rounded-md bg-red-800 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
                  Start fresh
                </button>
              : <button type="button" onClick={() => void loadMore()}
                  className="mt-3 min-h-11 rounded-md bg-red-800 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
                  Retry loading more
                </button>}
          </div>}
        {!laterError && query.hasNextPage &&
          <div className="mt-5">
            <button type="button" onClick={() => void loadMore()}
              disabled={query.isFetchingNextPage} aria-describedby="adjustment-history-pagination-status"
              className="min-h-11 rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 disabled:cursor-wait disabled:opacity-60">
              {query.isFetchingNextPage ? 'Loading more…' : 'Load more'}
            </button>
            <p id="adjustment-history-pagination-status" role="status" className="mt-2 text-sm text-gray-700">
              {query.isFetchingNextPage ? 'Loading the next cursor page.' : 'More results are available from this snapshot.'}
            </p>
          </div>}
        {!laterError && !query.hasNextPage &&
          <p ref={endRef} tabIndex={-1} role="status"
            className="state-indicator mt-5 rounded-md border border-gray-400 bg-gray-50 p-3 text-sm font-medium text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
            End of adjustment history results.
          </p>}
      </>}
    </HistoryPageFrame>
  )
}

function PermissionAwareAdjustmentHistoryPage({ clientId }: { clientId: string }) {
  const { hasPermission } = useAuth()
  const allowed = hasPermission('billing:view')
  const previouslyAllowed = useRef(allowed)
  const [permissionLost, setPermissionLost] = useState(false)
  const queryClient = useQueryClient()

  useLayoutEffect(() => {
    if (previouslyAllowed.current && !allowed) {
      void clearPrivateBillingQueries(queryClient)
      setPermissionLost(true)
    }
    previouslyAllowed.current = allowed
  }, [allowed, queryClient])

  return permissionLost
    ? <HistoryPageFrame clientId={clientId}>
        <Forbidden message="Billing permission is no longer available. Private adjustment history was removed." />
      </HistoryPageFrame>
    : <CanonicalAdjustmentHistoryPage key={clientId} clientId={clientId} />
}

export function BillingAdjustmentHistoryPage() {
  const { clientId: routeClientId } = useParams()
  const clientId = canonicalizeGuid(routeClientId)
  if (!clientId)
    return <EmptyState title="Client context unavailable"
      description="A valid Client URL is required for the Billing workspace." />
  if (routeClientId !== clientId)
    return <Navigate to={`/billing/clients/${clientId}/adjustments`} replace />
  return <PermissionAwareAdjustmentHistoryPage key={clientId} clientId={clientId} />
}
