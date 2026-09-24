import { useEffect, useRef, useState } from 'react'
import { canonicalizeGuid } from '../../lib/guid'
import { normalizeLocalWallInput } from '../../timezone/LocalInstant'
import type { CreditAdjustmentHistoryFilters } from '../../types/billing'
import { FormErrorSummary, type FormFieldError } from '../shared'

export interface AdjustmentHistoryFilterDraft {
  from: string
  to: string
  actorUserId: string
  reason: string
  operationId: string
  originalAdjustmentId: string
  reversalAdjustmentId: string
  operationType: string
  pageSize: string
}

export const EMPTY_ADJUSTMENT_HISTORY_FILTER_DRAFT: AdjustmentHistoryFilterDraft = {
  from: '', to: '', actorUserId: '', reason: '', operationId: '',
  originalAdjustmentId: '', reversalAdjustmentId: '', operationType: '', pageSize: '',
}

type FilterErrorKey = keyof AdjustmentHistoryFilterDraft | 'range'
type FilterErrors = Partial<Record<FilterErrorKey, string>>
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PAGE_SIZE = /^(?:[1-9]|[1-9]\d|100)$/

const LABELS: Record<FilterErrorKey, string> = {
  from: 'From', to: 'To', actorUserId: 'Actor user ID', reason: 'Exact reason',
  operationId: 'Operation ID', originalAdjustmentId: 'Original adjustment ID',
  reversalAdjustmentId: 'Reversal adjustment ID', operationType: 'Operation type',
  pageSize: 'Page size', range: 'Date range',
}

const fieldId = (field: keyof AdjustmentHistoryFilterDraft) =>
  `adjustment-history-${field}`

export function normalizeAdjustmentHistoryFilterDraft(draft: AdjustmentHistoryFilterDraft): {
  filters?: CreditAdjustmentHistoryFilters
  errors: FilterErrors
} {
  const filters: CreditAdjustmentHistoryFilters = {}
  const errors: FilterErrors = {}

  for (const field of ['from', 'to'] as const) {
    const value = draft[field].trim()
    if (!value) continue
    try { filters[field] = normalizeLocalWallInput(value) }
    catch { errors[field] = 'Enter a valid local date and time.' }
  }
  if (filters.from && filters.to && filters.from >= filters.to)
    errors.range = 'From must be earlier than To.'

  const actor = draft.actorUserId.trim()
  if (actor) {
    const canonical = canonicalizeGuid(actor)
    if (canonical && canonical !== '00000000-0000-0000-0000-000000000000')
      filters.actorUserId = canonical
    else errors.actorUserId = 'Enter a non-empty complete hyphenated UUID.'
  }

  for (const field of [
    'operationId', 'originalAdjustmentId', 'reversalAdjustmentId',
  ] as const) {
    const value = draft[field].trim()
    if (!value) continue
    const canonical = canonicalizeGuid(value)
    if (canonical && UUID_V7.test(canonical)) filters[field] = canonical
    else errors[field] = 'Enter a canonical RFC 9562 UUIDv7.'
  }

  if (draft.reason !== '') {
    const scalars = [...draft.reason]
    if (draft.reason !== draft.reason.trim() || scalars.length > 512 ||
        /\p{Cc}/u.test(draft.reason) || /[\uD800-\uDFFF]/u.test(draft.reason))
      errors.reason = 'Use 1–512 Unicode characters with no surrounding whitespace or controls.'
    else filters.reason = draft.reason
  }

  if (draft.operationType !== '') {
    if (draft.operationType === 'original' || draft.operationType === 'reversal')
      filters.operationType = draft.operationType
    else errors.operationType = 'Select Original or Reversal.'
  }

  const pageSize = draft.pageSize.trim()
  if (pageSize) {
    if (PAGE_SIZE.test(pageSize)) filters.pageSize = pageSize
    else errors.pageSize = 'Page size must be a canonical whole number from 1 to 100.'
  }

  return Object.keys(errors).length > 0 ? { errors } : { filters, errors }
}

interface AdjustmentHistoryFiltersProps {
  appliedFiltersActive: boolean
  busy: boolean
  onApply: (filters: CreditAdjustmentHistoryFilters) => void
  onClear: () => void
  serverFieldError?: { field: 'from' | 'to'; message: string } | null
}

export function AdjustmentHistoryFilters({
  appliedFiltersActive, busy, onApply, onClear, serverFieldError = null,
}: AdjustmentHistoryFiltersProps) {
  const [draft, setDraft] = useState(EMPTY_ADJUSTMENT_HISTORY_FILTER_DRAFT)
  const [errors, setErrors] = useState<FilterErrors>({})
  const summaryRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const displayedErrors: FilterErrors = serverFieldError
    ? { ...errors, [serverFieldError.field]: serverFieldError.message } : errors

  useEffect(() => {
    if (serverFieldError) requestAnimationFrame(() => summaryRef.current?.focus())
  }, [serverFieldError])

  const setField = (field: keyof AdjustmentHistoryFilterDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))
  const summaryErrors: FormFieldError[] = Object.entries(displayedErrors).map(
    ([key, message]) => {
      const field = key as FilterErrorKey
      const target = field === 'range' ? 'from' : field
      return { fieldId: fieldId(target), label: LABELS[field], message: message! }
    })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = normalizeAdjustmentHistoryFilterDraft(draft)
    setErrors(normalized.errors)
    if (!normalized.filters) {
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    onApply(normalized.filters)
  }
  const clear = () => {
    setDraft(EMPTY_ADJUSTMENT_HISTORY_FILTER_DRAFT)
    setErrors({})
    onClear()
    requestAnimationFrame(() => headingRef.current?.focus())
  }
  const errorFor = (field: keyof AdjustmentHistoryFilterDraft) => displayedErrors[field]

  return (
    <section aria-labelledby="adjustment-history-filter-heading"
      className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 id="adjustment-history-filter-heading" ref={headingRef} tabIndex={-1}
        className="text-lg font-semibold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
        Filter adjustment history
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Dates and times use your saved timezone. From is inclusive; To is exclusive.
      </p>
      <div className="mt-4"><FormErrorSummary ref={summaryRef} errors={summaryErrors} /></div>

      <form onSubmit={submit} noValidate
        className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DateField field="from" label="From (your saved timezone, inclusive)" value={draft.from}
          error={errorFor('from') ?? displayedErrors.range}
          onChange={(value) => setField('from', value)} />
        <DateField field="to" label="To (your saved timezone, exclusive)" value={draft.to}
          error={errorFor('to')} onChange={(value) => setField('to', value)} />
        <TextField field="actorUserId" label="Actor user ID" value={draft.actorUserId}
          error={errorFor('actorUserId')} onChange={(value) => setField('actorUserId', value)} />
        <TextField field="reason" label="Exact reason" value={draft.reason}
          error={errorFor('reason')} mono={false} onChange={(value) => setField('reason', value)} />
        <TextField field="operationId" label="Operation ID" value={draft.operationId}
          error={errorFor('operationId')} onChange={(value) => setField('operationId', value)} />
        <TextField field="originalAdjustmentId" label="Original adjustment ID"
          value={draft.originalAdjustmentId} error={errorFor('originalAdjustmentId')}
          onChange={(value) => setField('originalAdjustmentId', value)} />
        <TextField field="reversalAdjustmentId" label="Reversal adjustment ID"
          value={draft.reversalAdjustmentId} error={errorFor('reversalAdjustmentId')}
          onChange={(value) => setField('reversalAdjustmentId', value)} />
        <SelectField field="operationType" label="Operation type" value={draft.operationType}
          error={errorFor('operationType')} onChange={(value) => setField('operationType', value)}
          options={[["", 'All operation types'], ['original', 'Original adjustment'],
            ['reversal', 'Compensating reversal']]} />
        <SelectField field="pageSize" label="Page size" value={draft.pageSize}
          error={errorFor('pageSize')} onChange={(value) => setField('pageSize', value)}
          options={[["", 'Server default (20)'], ['10', '10'], ['20', '20'],
            ['50', '50'], ['100', '100']]} />

        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 xl:col-span-3">
          <button type="submit" disabled={busy}
            className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
            {busy ? 'Applying…' : 'Apply filters'}
          </button>
          {appliedFiltersActive && <button type="button" onClick={clear} disabled={busy}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">
            Clear filters
          </button>}
        </div>
      </form>
    </section>
  )
}

function DateField({ field, label, value, error, onChange }: {
  field: 'from' | 'to'; label: string; value: string; error?: string
  onChange: (value: string) => void
}) {
  const id = fieldId(field)
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label>
    <input id={id} type="datetime-local" step="0.000001" value={value}
      onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
    {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
  </div>
}

function TextField({ field, label, value, error, onChange, mono = true }: {
  field: keyof AdjustmentHistoryFilterDraft; label: string; value: string; error?: string
  onChange: (value: string) => void; mono?: boolean
}) {
  const id = fieldId(field)
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label>
    <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      autoComplete="off" spellCheck={false}
      className={`mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${mono ? 'font-mono' : ''}`} />
    {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
  </div>
}

function SelectField({ field, label, value, error, onChange, options }: {
  field: 'operationType' | 'pageSize'; label: string; value: string; error?: string
  onChange: (value: string) => void; options: Array<[string, string]>
}) {
  const id = fieldId(field)
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
    {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
  </div>
}
