import type { BillingLedgerItem, BillingLedgerTransactionType } from '../../types/billing'
import { CreditAmount } from './CreditAmount'

const TYPE_PRESENTATION: Record<BillingLedgerTransactionType, { label: string; description: string }> = {
  subscription_grant: { label: 'Subscription grant', description: 'Positive owned-credit grant.' },
  reservation: { label: 'Reservation hold', description: 'Negative available-credit hold; owned credits remain authoritative.' },
  consumption: { label: 'Credit consumption', description: 'Negative owned-credit use.' },
  manual_adjustment: { label: 'Manual adjustment', description: 'Signed owned-credit adjustment.' },
  reversal: { label: 'Reversal', description: 'Signed reversal of a prior operation.' },
  promotion: { label: 'Promotion', description: 'Positive owned-credit grant.' },
  reservation_expired: { label: 'Reservation expired / hold released', description: 'Positive release of reserved capacity; not income or an owned-credit grant.' },
  reservation_committed: { label: 'Reservation committed / hold released', description: 'Positive release of the original hold; not income. Consumption is a distinct operation.' },
  reservation_released: { label: 'Reservation released', description: 'Positive release of reserved capacity; not income or an owned-credit grant.' },
}

function DisplayTime({ value }: { value: string }) {
  const display = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' })
    .format(new Date(value))
  return <time dateTime={value}>{display}</time>
}

const IDENTIFIERS: Array<[keyof BillingLedgerItem, string]> = [
  ['ledgerId', 'Ledger ID'],
  ['creditAccountId', 'Credit account ID'],
  ['operationId', 'Operation ID'],
  ['jobId', 'Job ID'],
  ['reservationId', 'Reservation ID'],
  ['adjustmentId', 'Adjustment ID'],
  ['ruleId', 'Rule ID'],
  ['ruleVersion', 'Rule version'],
]

function Identifiers({ item }: { item: BillingLedgerItem }) {
  return (
    <dl className="space-y-1 text-xs">
      {IDENTIFIERS.map(([key, label]) => {
        const value = item[key]
        if (value === null) return null
        return (
          <div key={key} className="min-w-0">
            <dt className="inline font-semibold text-gray-600">{label}: </dt>
            <dd className="inline select-text break-all font-mono text-gray-900">{String(value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function ActorReason({ item }: { item: BillingLedgerItem }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="break-all text-sm"><span className="font-semibold text-gray-600">Actor: </span>{item.actorUserId ?? 'No actor recorded'}</p>
      <p className="break-words text-sm"><span className="font-semibold text-gray-600">Reason: </span>{item.reason ?? 'No reason recorded'}</p>
    </div>
  )
}

export function LedgerResults({ items }: { items: BillingLedgerItem[] }) {
  return (
    <section aria-labelledby="ledger-results-heading" className="min-w-0">
      <h2 id="ledger-results-heading" className="mb-3 text-lg font-semibold text-gray-950">Ledger operations</h2>

      <div tabIndex={0} role="region" aria-label="Scrollable ledger table" className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 md:block">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Newest-first immutable Billing ledger operations</caption>
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th scope="col" className="w-40 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Time</th>
              <th scope="col" className="w-48 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Type</th>
              <th scope="col" className="w-44 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Signed credits</th>
              <th scope="col" className="w-44 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Owned balance after</th>
              <th scope="col" className="w-64 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Actor and reason</th>
              <th scope="col" className="w-80 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Immutable identifiers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {items.map((item) => {
              const presentation = TYPE_PRESENTATION[item.transactionType]
              return (
                <tr key={item.ledgerId} data-ledger-id={item.ledgerId} className="align-top">
                  <td className="px-3 py-4 text-sm text-gray-800"><DisplayTime value={item.createdAt} /></td>
                  <td className="px-3 py-4"><p className="text-sm font-semibold text-gray-950">{presentation.label}</p><p className="mt-1 break-words text-xs text-gray-600">{presentation.description}</p></td>
                  <td className="px-3 py-4"><CreditAmount value={item.amount} signed compact /></td>
                  <td className="px-3 py-4"><CreditAmount value={item.balanceAfter} compact /></td>
                  <td className="px-3 py-4"><ActorReason item={item} /></td>
                  <td className="px-3 py-4"><Identifiers item={item} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ol aria-label="Newest-first immutable Billing ledger operations" className="space-y-4 md:hidden">
        {items.map((item) => {
          const presentation = TYPE_PRESENTATION[item.transactionType]
          return (
            <li key={item.ledgerId} data-ledger-id={item.ledgerId} className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <dl className="space-y-3">
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Time</dt><dd className="mt-1 break-words text-sm text-gray-900"><DisplayTime value={item.createdAt} /></dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Type</dt><dd className="mt-1 text-sm font-semibold text-gray-950">{presentation.label}</dd><dd className="mt-1 break-words text-sm text-gray-600">{presentation.description}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Signed credits</dt><dd className="mt-1"><CreditAmount value={item.amount} signed compact /></dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Owned balance after</dt><dd className="mt-1"><CreditAmount value={item.balanceAfter} compact /></dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Actor and reason</dt><dd className="mt-1"><ActorReason item={item} /></dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">Immutable identifiers</dt><dd className="mt-1"><Identifiers item={item} /></dd></div>
              </dl>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
