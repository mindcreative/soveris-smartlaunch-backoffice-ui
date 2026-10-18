import type { BillingAccountSnapshot } from '../../types/billing'
import { CreditAmount } from './CreditAmount'
import { LocalInstant } from '../../timezone/LocalInstant'

const statusClasses = {
  active: 'bg-success-soft text-success',
  suspended: 'bg-warning-soft text-warning',
  closed: 'bg-hover text-foreground',
} as const

function AmountCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-5 shadow-sm">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="mt-2 min-w-0"><CreditAmount value={value} /></dd>
    </div>
  )
}

export function AccountSnapshotView({ snapshot }: { snapshot: BillingAccountSnapshot }) {
  return (
    <section aria-labelledby="account-summary-heading" className="space-y-5">
      <h2 id="account-summary-heading" className="sr-only">Current credit account snapshot</h2>
      <dl className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
        <AmountCard label="Owned balance" value={snapshot.ownedBalance} />
        <AmountCard label="Actively reserved" value={snapshot.activelyReservedAmount} />
        <AmountCard label="Available balance" value={snapshot.availableBalance} />
      </dl>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-5">
          <dt className="text-sm font-medium text-muted">Active reservations</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {snapshot.activeReservationCount}
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5">
          <dt className="text-sm font-medium text-muted">Account status</dt>
          <dd className="mt-3">
            <span className={`state-indicator inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${statusClasses[snapshot.status]}`}>
              {snapshot.status}
            </span>
          </dd>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface p-5">
          <dt className="text-sm font-medium text-muted">Snapshot as of</dt>
          <dd className="mt-2 break-words text-sm font-medium text-foreground">
            <LocalInstant value={snapshot.asOf} />
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-primary-line bg-selected p-4 text-sm text-primary">
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
