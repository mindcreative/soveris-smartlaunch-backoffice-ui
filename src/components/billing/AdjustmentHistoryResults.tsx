import type { ReactNode } from 'react'
import type { CreditAdjustmentHistoryItem } from '../../types/billing'
import { LocalInstant } from '../../timezone/LocalInstant'
import { CreditAmount } from './CreditAmount'

function TypeAndRelationship({ item }: { item: CreditAdjustmentHistoryItem }) {
  if (item.operationType === 'reversal') {
    return (
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-gray-950">Reversal</p>
        <p className="select-text break-all font-mono text-xs text-gray-700">
          Reversal of {item.originalAdjustmentId}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-1">
      <p className="font-semibold text-gray-950">Original adjustment</p>
      <p className="select-text break-all font-mono text-xs text-gray-700">
        {item.reversalAdjustmentId === null
          ? 'No linked reversal in this snapshot'
          : `Reversed by ${item.reversalAdjustmentId}`}
      </p>
    </div>
  )
}

function ReasonAndActor({ item }: { item: CreditAdjustmentHistoryItem }) {
  return (
    <div className="min-w-0 space-y-2 text-sm">
      <p className="break-words text-gray-900"><span className="font-semibold">Reason: </span>{item.reason}</p>
      <p className="select-text break-all text-gray-900"><span className="font-semibold">Performed by: </span>{item.performedBy}</p>
    </div>
  )
}

const BALANCES: Array<[keyof CreditAdjustmentHistoryItem, string]> = [
  ['beforeOwnedBalance', 'Owned before'],
  ['beforeReservedBalance', 'Reserved before'],
  ['beforeAvailableBalance', 'Available before'],
  ['afterOwnedBalance', 'Owned after'],
  ['afterReservedBalance', 'Reserved after'],
  ['afterAvailableBalance', 'Available after'],
]

function Balances({ item }: { item: CreditAdjustmentHistoryItem }) {
  return (
    <dl className="space-y-2">
      {BALANCES.map(([key, label]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-semibold text-gray-600">{label}:</dt>
          <dd className="mt-0.5"><CreditAmount value={String(item[key])} compact /></dd>
        </div>
      ))}
    </dl>
  )
}

const IDENTIFIERS: Array<[keyof CreditAdjustmentHistoryItem, string]> = [
  ['schemaVersion', 'Schema version'],
  ['clientId', 'Client ID'],
  ['creditAccountId', 'Credit account ID'],
  ['operationId', 'Operation ID'],
  ['adjustmentId', 'Adjustment ID'],
  ['ledgerId', 'Ledger ID'],
  ['expectedWalletVersion', 'Expected wallet version'],
  ['walletVersionBefore', 'Wallet version before'],
  ['walletVersionAfter', 'Wallet version after'],
]

function IdentifiersAndVersions({ item }: { item: CreditAdjustmentHistoryItem }) {
  return (
    <dl className="space-y-1 text-xs">
      {IDENTIFIERS.map(([key, label]) => (
        <div key={key} className="min-w-0">
          <dt className="sr-only">{label}</dt>
          <dd className="select-text break-all font-mono text-gray-900">{label}: {String(item[key])}</dd>
        </div>
      ))}
    </dl>
  )
}

function ImmutableExplanation() {
  return (
    <p className="mb-3 max-w-4xl text-sm text-gray-700">
      This is immutable operational evidence. Corrections are recorded as separate compensating rows,
      preserving the original adjustment and its relationship.
    </p>
  )
}

function NarrowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</dt>
      <dd className="mt-1 min-w-0">{children}</dd>
    </div>
  )
}

interface AdjustmentHistoryResultsProps {
  items: CreditAdjustmentHistoryItem[]
  canAdjust?: boolean
  onReviewReversal?: (item: CreditAdjustmentHistoryItem & { operationType: 'original' },
    trigger: HTMLButtonElement) => void
}

function canReviewReversal(item: CreditAdjustmentHistoryItem): item is
  CreditAdjustmentHistoryItem & { operationType: 'original' } {
  return item.operationType === 'original' && item.reversalAdjustmentId === null
}

function ReversalAction({ item, onReviewReversal }: {
  item: CreditAdjustmentHistoryItem & { operationType: 'original' }
  onReviewReversal?: AdjustmentHistoryResultsProps['onReviewReversal']
}) {
  return (
    <button type="button"
      aria-label={`Review reversal for original adjustment ${item.adjustmentId}`}
      onClick={(event) => onReviewReversal?.(item, event.currentTarget)}
      className="min-h-11 rounded-md border border-gray-400 bg-white px-3 py-2 text-sm font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700">
      Review reversal
    </button>
  )
}

export function AdjustmentHistoryResults({
  items,
  canAdjust = false,
  onReviewReversal,
}: AdjustmentHistoryResultsProps) {
  return (
    <section aria-labelledby="adjustment-history-results-heading" className="min-w-0">
      <h2 id="adjustment-history-results-heading" className="mb-2 text-lg font-semibold text-gray-950">
        Adjustment history evidence
      </h2>
      <ImmutableExplanation />

      <div tabIndex={0} role="region" aria-label="Scrollable adjustment history table"
        className="hidden overflow-x-auto rounded-lg border border-gray-300 bg-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 md:block">
        <table className="w-full min-w-[90rem] table-fixed border-collapse">
          <caption className="sr-only">Newest-first immutable Billing adjustment history</caption>
          <thead className="border-b border-gray-300 bg-gray-100">
            <tr>
              <th scope="col" className="w-44 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Time</th>
              <th scope="col" className="w-64 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Type and relationship</th>
              <th scope="col" className="w-64 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Signed credits</th>
              <th scope="col" className="w-80 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Reason and actor</th>
              <th scope="col" className="w-80 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Balances before and after</th>
              <th scope="col" className="w-96 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Immutable identifiers and wallet versions</th>
              {canAdjust && <th scope="col"
                className="w-48 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                Action
              </th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300">
            {items.map((item) => (
              <tr key={item.adjustmentId} data-adjustment-id={item.adjustmentId} className="align-top">
                <td className="px-3 py-4 text-sm text-gray-900"><LocalInstant value={item.operationAsOf} /></td>
                <td className="px-3 py-4"><TypeAndRelationship item={item} /></td>
                <td className="px-3 py-4"><CreditAmount value={item.amount} signed compact /></td>
                <td className="px-3 py-4"><ReasonAndActor item={item} /></td>
                <td className="px-3 py-4"><Balances item={item} /></td>
                <td className="px-3 py-4"><IdentifiersAndVersions item={item} /></td>
                {canAdjust && <td className="px-3 py-4">
                  {canReviewReversal(item) && <ReversalAction item={item}
                    onReviewReversal={onReviewReversal} />}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol aria-label="Newest-first immutable Billing adjustment history" className="space-y-4 md:hidden">
        {items.map((item) => (
          <li key={item.adjustmentId} data-adjustment-id={item.adjustmentId}
            className="min-w-0 rounded-lg border border-gray-300 bg-white p-4 shadow-sm">
            <dl className="space-y-4">
              <NarrowField label="Time"><LocalInstant value={item.operationAsOf} /></NarrowField>
              <NarrowField label="Type and relationship"><TypeAndRelationship item={item} /></NarrowField>
              <NarrowField label="Signed credits"><CreditAmount value={item.amount} signed compact /></NarrowField>
              <NarrowField label="Reason and actor"><ReasonAndActor item={item} /></NarrowField>
              <NarrowField label="Balances before and after"><Balances item={item} /></NarrowField>
              <NarrowField label="Immutable identifiers and wallet versions"><IdentifiersAndVersions item={item} /></NarrowField>
              {canAdjust && canReviewReversal(item) &&
                <NarrowField label="Available action">
                  <ReversalAction item={item} onReviewReversal={onReviewReversal} />
                </NarrowField>}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}
