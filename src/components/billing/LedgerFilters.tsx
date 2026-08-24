import { useRef, useState } from 'react'
import { canonicalizeGuid } from '../../lib/guid'
import {
  BILLING_LEDGER_TRANSACTION_TYPES,
  type BillingLedgerFilters,
  type BillingLedgerTransactionType,
} from '../../types/billing'

export interface LedgerFilterDraft {
  creditAccountId: string
  from: string
  to: string
  transactionType: string
  actorUserId: string
  jobId: string
  reservationId: string
  pageSize: string
}

export const EMPTY_LEDGER_FILTER_DRAFT: LedgerFilterDraft = {
  creditAccountId: '',
  from: '',
  to: '',
  transactionType: '',
  actorUserId: '',
  jobId: '',
  reservationId: '',
  pageSize: '',
}

type FilterErrors = Partial<Record<keyof LedgerFilterDraft | 'range', string>>

const FILTER_ERROR_LABELS: Record<keyof LedgerFilterDraft | 'range', string> = {
  creditAccountId: 'Credit account ID',
  from: 'From',
  to: 'To',
  transactionType: 'Transaction type',
  actorUserId: 'Actor user ID',
  jobId: 'Job ID',
  reservationId: 'Reservation ID',
  pageSize: 'Page size',
  range: 'Date range',
}

export function normalizeLedgerFilterDraft(draft: LedgerFilterDraft): {
  filters?: BillingLedgerFilters
  errors: FilterErrors
} {
  const errors: FilterErrors = {}
  const filters: BillingLedgerFilters = {}
  const guidFields = ['creditAccountId', 'actorUserId', 'jobId', 'reservationId'] as const
  for (const field of guidFields) {
    const value = draft[field].trim()
    if (!value) continue
    const canonical = canonicalizeGuid(value)
    if (canonical) filters[field] = canonical
    else errors[field] = 'Enter a complete hyphenated GUID.'
  }

  const instants: Partial<Record<'from' | 'to', number>> = {}
  for (const field of ['from', 'to'] as const) {
    const value = draft[field].trim()
    if (!value) continue
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) errors[field] = 'Enter a valid local date and time.'
    else {
      filters[field] = date.toISOString()
      instants[field] = date.getTime()
    }
  }
  if (instants.from !== undefined && instants.to !== undefined && instants.from >= instants.to) {
    errors.range = 'From must be earlier than To.'
  }

  const transactionType = draft.transactionType.trim().toLowerCase()
  if (transactionType) {
    if ((BILLING_LEDGER_TRANSACTION_TYPES as readonly string[]).includes(transactionType)) {
      filters.transactionType = transactionType as BillingLedgerTransactionType
    } else errors.transactionType = 'Select a supported transaction type.'
  }

  const pageSizeText = draft.pageSize.trim()
  if (pageSizeText) {
    const pageSize = Number(pageSizeText)
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      errors.pageSize = 'Page size must be a whole number from 1 to 100.'
    } else filters.pageSize = pageSize
  }

  return Object.keys(errors).length ? { errors } : { filters, errors }
}

const TRANSACTION_OPTIONS: Array<[BillingLedgerTransactionType, string]> = [
  ['subscription_grant', 'Subscription grant'],
  ['reservation', 'Reservation hold'],
  ['consumption', 'Credit consumption'],
  ['manual_adjustment', 'Manual adjustment'],
  ['reversal', 'Reversal'],
  ['promotion', 'Promotion'],
  ['reservation_expired', 'Reservation expired / hold released'],
  ['reservation_committed', 'Reservation committed / hold released'],
  ['reservation_released', 'Reservation released'],
]

interface LedgerFiltersProps {
  appliedFiltersActive: boolean
  busy: boolean
  onApply: (filters: BillingLedgerFilters) => void
  onClear: () => void
}

export function LedgerFilters({ appliedFiltersActive, busy, onApply, onClear }: LedgerFiltersProps) {
  const [draft, setDraft] = useState<LedgerFilterDraft>(EMPTY_LEDGER_FILTER_DRAFT)
  const [errors, setErrors] = useState<FilterErrors>({})
  const summaryRef = useRef<HTMLDivElement>(null)
  const applyRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'

  const setField = (field: keyof LedgerFilterDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const describedBy = (field: keyof LedgerFilterDraft) =>
    errors[field] ? `ledger-${field}-error` : undefined

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = normalizeLedgerFilterDraft(draft)
    setErrors(normalized.errors)
    if (!normalized.filters) {
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    onApply(normalized.filters)
  }

  const clear = () => {
    headingRef.current?.focus()
    setDraft(EMPTY_LEDGER_FILTER_DRAFT)
    setErrors({})
    onClear()
  }

  return (
    <section aria-labelledby="ledger-filter-heading" className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 id="ledger-filter-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Filter ledger operations</h2>
      <p className="mt-1 text-sm text-gray-600">Dates and times use {timezone}. From is inclusive; To is exclusive.</p>

      {Object.keys(errors).length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="state-indicator mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
          <p className="font-semibold">Check the filter values.</p>
          <ul className="mt-2 list-disc pl-5">
            {Object.entries(errors).map(([field, message]) => {
              const errorField = field as keyof FilterErrors
              const target = errorField === 'range' ? 'from' : errorField
              return (
                <li key={field}>
                  <a href={`#ledger-${target}`} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                    {FILTER_ERROR_LABELS[errorField]}: {message}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FilterInput id="creditAccountId" label="Credit account ID" value={draft.creditAccountId} error={errors.creditAccountId} describedBy={describedBy('creditAccountId')} onChange={(value) => setField('creditAccountId', value)} />
        <FilterInput id="actorUserId" label="Actor user ID" value={draft.actorUserId} error={errors.actorUserId} describedBy={describedBy('actorUserId')} onChange={(value) => setField('actorUserId', value)} />
        <FilterInput id="jobId" label="Job ID" value={draft.jobId} error={errors.jobId} describedBy={describedBy('jobId')} onChange={(value) => setField('jobId', value)} />
        <FilterInput id="reservationId" label="Reservation ID" value={draft.reservationId} error={errors.reservationId} describedBy={describedBy('reservationId')} onChange={(value) => setField('reservationId', value)} />

        <div className="min-w-0">
          <label htmlFor="ledger-from" className="block text-sm font-medium text-gray-800">From ({timezone}, inclusive)</label>
          <input id="ledger-from" type="datetime-local" value={draft.from} onChange={(event) => setField('from', event.target.value)} aria-invalid={Boolean(errors.from || errors.range)} aria-describedby={errors.from ? 'ledger-from-error' : errors.range ? 'ledger-range-error' : undefined} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
          {errors.from && <p id="ledger-from-error" className="mt-1 text-sm text-red-700">{errors.from}</p>}
        </div>
        <div className="min-w-0">
          <label htmlFor="ledger-to" className="block text-sm font-medium text-gray-800">To ({timezone}, exclusive)</label>
          <input id="ledger-to" type="datetime-local" value={draft.to} onChange={(event) => setField('to', event.target.value)} aria-invalid={Boolean(errors.to || errors.range)} aria-describedby={errors.to ? 'ledger-to-error' : errors.range ? 'ledger-range-error' : undefined} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
          {errors.to && <p id="ledger-to-error" className="mt-1 text-sm text-red-700">{errors.to}</p>}
          {errors.range && <p id="ledger-range-error" className="mt-1 text-sm text-red-700">{errors.range}</p>}
        </div>
        <div>
          <label htmlFor="ledger-transactionType" className="block text-sm font-medium text-gray-800">Transaction type</label>
          <select id="ledger-transactionType" value={draft.transactionType} onChange={(event) => setField('transactionType', event.target.value)} aria-invalid={Boolean(errors.transactionType)} aria-describedby={describedBy('transactionType')} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            <option value="">All transaction types</option>
            {TRANSACTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {errors.transactionType && <p id="ledger-transactionType-error" className="mt-1 text-sm text-red-700">{errors.transactionType}</p>}
        </div>
        <div>
          <label htmlFor="ledger-pageSize" className="block text-sm font-medium text-gray-800">Page size</label>
          <select id="ledger-pageSize" value={draft.pageSize} onChange={(event) => setField('pageSize', event.target.value)} aria-invalid={Boolean(errors.pageSize)} aria-describedby={describedBy('pageSize')} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            <option value="">Server default (20)</option>
            {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          {errors.pageSize && <p id="ledger-pageSize-error" className="mt-1 text-sm text-red-700">{errors.pageSize}</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 xl:col-span-4">
          <button id="ledger-apply" ref={applyRef} type="submit" disabled={busy} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
            {busy ? 'Applying…' : 'Apply filters'}
          </button>
          {appliedFiltersActive && (
            <button type="button" onClick={clear} disabled={busy} className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">
              Clear filters
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

function FilterInput({ id, label, value, error, describedBy, onChange }: {
  id: keyof LedgerFilterDraft
  label: string
  value: string
  error?: string
  describedBy?: string
  onChange: (value: string) => void
}) {
  const inputId = `ledger-${id}`
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-800">{label}</label>
      <input id={inputId} type="text" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} autoComplete="off" spellCheck={false} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
      {error && <p id={`ledger-${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  )
}
