import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { Breadcrumbs, EmptyState } from '../../components/shared'
import { canonicalizeGuid } from '../../lib/guid'

export function BillingLedgerBoundaryPage() {
  const { clientId: routeClientId } = useParams()
  const clientId = canonicalizeGuid(routeClientId)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (clientId) headingRef.current?.focus()
  }, [clientId])

  if (!clientId) {
    return (
      <EmptyState
        title="Client context unavailable"
        description="A valid Client URL is required for the Billing workspace."
      />
    )
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl">
      <Breadcrumbs items={[
        { label: 'Billing', href: `/billing/clients/${clientId}/account` },
        { label: 'Ledger history' },
        { label: `Selected Client ${clientId}` },
      ]} />
      <BillingWorkspaceNav clientId={clientId} />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        Ledger history
      </h1>
      <div role="status" className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-5 text-blue-950">
        <p className="font-semibold">Ledger history is not available in this story.</p>
        <p className="mt-2 text-sm">
          Story 1.6 owns terminal reservation history, ledger rows, filtering, and cursor traversal.
          No ledger request is made here.
        </p>
      </div>
    </div>
  )
}
