import type { BillingAccountSnapshot } from '../../types/billing'
import { CreditAmount } from './CreditAmount'

const statusClasses = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-amber-100 text-amber-900',
  closed: 'bg-gray-200 text-gray-800',
} as const

function AmountCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <dt className="text-sm font-medium text-gray-600">{label}</dt>
      <dd className="mt-2 min-w-0"><CreditAmount value={value} /></dd>
    </div>
  )
}

export function AccountSnapshotView({ snapshot }: { snapshot: BillingAccountSnapshot }) {
  const displayAsOf = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(snapshot.asOf))

  return (
    <section aria-labelledby="account-summary-heading" className="space-y-5">
      <h2 id="account-summary-heading" className="sr-only">Current credit account snapshot</h2>
      <dl className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
        <AmountCard label="Owned balance" value={snapshot.ownedBalance} />
        <AmountCard label="Actively reserved" value={snapshot.activelyReservedAmount} />
        <AmountCard label="Available balance" value={snapshot.availableBalance} />
      </dl>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <dt className="text-sm font-medium text-gray-600">Active reservations</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-gray-950">
            {snapshot.activeReservationCount}
          </dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <dt className="text-sm font-medium text-gray-600">Account status</dt>
          <dd className="mt-3">
            <span className={`state-indicator inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${statusClasses[snapshot.status]}`}>
              {snapshot.status}
            </span>
          </dd>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-5">
          <dt className="text-sm font-medium text-gray-600">Snapshot as of</dt>
          <dd className="mt-2 break-words text-sm font-medium text-gray-900">
            <time dateTime={snapshot.asOf} aria-label={`Snapshot as of ${displayAsOf}`}>
              {displayAsOf}
            </time>
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p>
          Active reservations are represented by the current amount and count above. These values are
          independently supplied by the server.
        </p>
        <p className="mt-2">
          Committed, released, and expired reservation history is terminal history and is reviewed in Ledger.
        </p>
      </div>
    </section>
  )
}
