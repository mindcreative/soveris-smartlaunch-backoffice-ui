import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import type { ApiError } from '../../api/apiClient'
import { BillingContractError } from '../../api/billingApi'
import { AccountSnapshotView } from '../../components/billing/AccountSnapshotView'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Breadcrumbs, EmptyState, ErrorDisplay, Forbidden, LoadingSpinner } from '../../components/shared'
import { useAuth } from '../../hooks/useAuth'
import { canonicalizeGuid } from '../../lib/guid'
import { useBillingAccount } from '../../queries/billingQueries'

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status
    : undefined
}

function isDurableAccountError(error: unknown): error is Error | ApiError {
  const status = errorStatus(error)
  return error instanceof BillingContractError || status === 401 || status === 403 || status === 404
}

function accountBreadcrumbs(clientId: string) {
  return [
    { label: 'Billing', href: `/billing/clients/${clientId}/account` },
    { label: 'Account overview' },
    { label: `Selected Client ${clientId}` },
  ]
}

function ClientContextUnavailable() {
  return (
    <EmptyState
      title="Client context unavailable"
      description="Open Billing from an authorized Client context or use a canonical Client account URL."
    />
  )
}

export function BillingIndexPage() {
  const { user } = useAuth()
  const clientId = canonicalizeGuid(user?.clientId)

  return clientId
    ? <Navigate to={`/billing/clients/${clientId}/account`} replace />
    : <ClientContextUnavailable />
}

function CanonicalBillingAccountPage({
  clientId,
  onDurableError,
}: {
  clientId: string
  onDurableError: (error: Error | ApiError) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const query = useBillingAccount(clientId)

  useEffect(() => {
    if (clientId) headingRef.current?.focus()
  }, [clientId])

  useEffect(() => {
    if (isDurableAccountError(query.error)) {
      onDurableError(query.error)
    }
  }, [onDurableError, query.error])

  const status = errorStatus(query.error)
  const snapshotMustBeHidden =
    status === 401 ||
    status === 403 ||
    status === 404 ||
    query.error instanceof BillingContractError
  const snapshot = snapshotMustBeHidden ? undefined : query.data

  return (
    <div className="mx-auto min-w-0 max-w-7xl">
      <Breadcrumbs items={accountBreadcrumbs(clientId)} />
      <BillingWorkspaceNav clientId={clientId} />
      <div className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            Account overview
          </h1>
          <p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p>
        </div>
        {snapshot && (
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60"
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh snapshot'}
          </button>
        )}
      </div>

      {query.isFetching && snapshot && (
        <p role="status" aria-label="Refreshing account snapshot" aria-live="polite" className="mb-4 text-sm font-medium text-indigo-700">
          Refreshing account snapshot…
        </p>
      )}

      {snapshot && (query.isFetching || query.isStale || query.isError) && (
        <div role="status" className="state-indicator mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {query.isError
            ? 'Refresh failed. Cached snapshot may be stale; values remain tied to the displayed Snapshot as of time.'
            : 'Cached snapshot may be stale. Values remain tied to the displayed Snapshot as of time.'}
        </div>
      )}

      {query.isPending && !snapshot && (
        <LoadingSpinner message="Loading account snapshot…" />
      )}

      {query.isError && !snapshot && !isDurableAccountError(query.error) && (
        <ErrorDisplay
          message="Account snapshot unavailable"
          detail="The current snapshot could not be loaded. Try again; no balance has been inferred."
          onRetry={() => void query.refetch()}
        />
      )}

      {snapshot && <AccountSnapshotView snapshot={snapshot} />}
    </div>
  )
}

function DurableBillingAccountPage({
  clientId,
  error,
}: {
  clientId: string
  error: Error | ApiError
}) {
  const status = errorStatus(error)

  return (
    <div className="mx-auto min-w-0 max-w-7xl">
      <Breadcrumbs items={accountBreadcrumbs(clientId)} />
      <BillingWorkspaceNav clientId={clientId} />
      <div className="mb-6 min-w-0">
        <h1 className="text-2xl font-bold text-gray-950">Account overview</h1>
        <p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p>
      </div>

      {status === 404 && (
        <EmptyState
          title="Credit account not configured"
          description="This Client does not have a configured credit account. No zero balance has been inferred."
        />
      )}
      {status === 403 && (
        <Forbidden message="The server denied Billing access for this Client." />
      )}
      {status === 401 && (
        <ErrorDisplay
          message="Session ended"
          detail="Sign in again to request this private account snapshot."
        />
      )}
      {status !== 401 && status !== 403 && status !== 404 && (
        <ErrorDisplay
          message="Account snapshot unavailable"
          detail="The server response did not match the Billing account contract. No balance has been displayed."
        />
      )}
    </div>
  )
}

function BillingAccountRoute({ clientId }: { clientId: string }) {
  const [durableState, setDurableState] = useState<{
    clientId: string
    error: Error | ApiError
  } | null>(null)
  const durableError = durableState?.clientId === clientId ? durableState.error : null
  const handleDurableError = useCallback((error: Error | ApiError) => {
    setDurableState({ clientId, error })
  }, [clientId])

  return durableError
    ? <DurableBillingAccountPage clientId={clientId} error={durableError} />
    : <CanonicalBillingAccountPage clientId={clientId} onDurableError={handleDurableError} />
}

export function BillingAccountPage() {
  const { clientId: routeClientId } = useParams()
  const clientId = canonicalizeGuid(routeClientId)

  if (!clientId) return <ClientContextUnavailable />
  if (routeClientId !== clientId) {
    return <Navigate to={`/billing/clients/${clientId}/account`} replace />
  }

  return <BillingAccountRoute clientId={clientId} />
}
