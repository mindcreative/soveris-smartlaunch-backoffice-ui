import { useEffect, useRef, useState } from 'react'
import type { CreateBillingSubscriptionMaterial } from '../../types/billing'
import { Modal } from '../shared/Modal'

export interface SubscriptionDraft {
  planName: string
  cycleCreditAmount: string
  requestsPerMinute: string
  concurrentAiOperations: string
  contentGeneration: boolean
  imageGeneration: boolean
  validFrom: string
  validTo: string
}

type DraftField = keyof SubscriptionDraft | 'features'
type DraftErrors = Partial<Record<DraftField, string>>

export const EMPTY_SUBSCRIPTION_DRAFT: SubscriptionDraft = {
  planName: '',
  cycleCreditAmount: '',
  requestsPerMinute: '',
  concurrentAiOperations: '',
  contentGeneration: false,
  imageGeneration: false,
  validFrom: '',
  validTo: '',
}

const FIELD_LABELS: Record<DraftField, string> = {
  planName: 'Plan name',
  cycleCreditAmount: 'Cycle credit amount',
  requestsPerMinute: 'Requests per minute',
  concurrentAiOperations: 'Concurrent AI operations',
  contentGeneration: 'Content generation',
  imageGeneration: 'Image generation',
  features: 'Feature access',
  validFrom: 'Valid from',
  validTo: 'Valid to',
}

const UTC_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function instantFromParts(parts: number[], microseconds: string): string {
  const [year, month, day, hour, minute, second] = parts
  return `${pad(year!, 4)}-${pad(month!)}-${pad(day!)}T${pad(hour!)}:${pad(minute!)}:${pad(second!)}.${microseconds}Z`
}

export function utcInputToInstant(value: string): string {
  const match = UTC_INPUT.exec(value)
  if (!match) throw new Error('Enter a valid UTC date and time.')
  const parts = match.slice(1, 7).map((part, index) => Number(part ?? (index === 5 ? '0' : '')))
  const [year, month, day, hour, minute, second] = parts
  const millis = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
  const check = new Date(millis)
  if (year! < 1 || year! > 9999 || check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month! - 1 || check.getUTCDate() !== day ||
      check.getUTCHours() !== hour || check.getUTCMinutes() !== minute ||
      check.getUTCSeconds() !== second) {
    throw new Error('Enter a valid UTC date and time.')
  }
  return instantFromParts(parts, (match[7] ?? '').padEnd(6, '0'))
}

export function addUtcCalendarMonths(instant: string, monthCount: number): string {
  const match = UTC_INSTANT.exec(instant)
  if (!match || !Number.isInteger(monthCount) || monthCount < 0) {
    throw new Error('A canonical UTC instant and whole calendar-month count are required.')
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const absoluteMonth = year! * 12 + month! - 1 + monthCount
  const targetYear = Math.floor(absoluteMonth / 12)
  const targetMonthIndex = absoluteMonth % 12
  if (targetYear < 1 || targetYear > 9999) throw new Error('UTC calendar result is out of range.')
  const targetDay = Math.min(day!, daysInUtcMonth(targetYear, targetMonthIndex))
  return instantFromParts(
    [targetYear, targetMonthIndex + 1, targetDay, hour!, minute!, second!],
    match[7]!
  )
}

function wholeNumber(value: string, minimum: number, maximum: number): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

export function validateSubscriptionDraft(draft: SubscriptionDraft, nowMs: number): {
  errors: DraftErrors
  material: CreateBillingSubscriptionMaterial | null
} {
  const errors: DraftErrors = {}
  if (draft.planName.length < 1 || draft.planName.length > 128 ||
      draft.planName.trim() !== draft.planName || draft.planName.includes('\0')) {
    errors.planName = 'Use 1–128 characters with no leading or trailing spaces.'
  }
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(draft.cycleCreditAmount) ||
      /^0(?:\.0{1,4})?$/.test(draft.cycleCreditAmount)) {
    errors.cycleCreditAmount = 'Enter a positive decimal with up to 14 integer and 4 fractional digits.'
  }
  const requestsPerMinute = wholeNumber(draft.requestsPerMinute, 1, 10_000)
  if (requestsPerMinute === null) errors.requestsPerMinute = 'Enter a whole number from 1 to 10,000.'
  const concurrentAiOperations = wholeNumber(draft.concurrentAiOperations, 1, 1_000)
  if (concurrentAiOperations === null) errors.concurrentAiOperations = 'Enter a whole number from 1 to 1,000.'
  if (!draft.contentGeneration && !draft.imageGeneration) {
    errors.features = 'Select at least one feature.'
  }

  let validFrom: string | null = null
  try { validFrom = utcInputToInstant(draft.validFrom) } catch { errors.validFrom = 'Enter a valid date and time declared in UTC.' }
  if (validFrom) {
    const fromMs = Date.parse(validFrom)
    if (fromMs > nowMs) errors.validFrom = 'Valid from cannot be in the future.'
    else if (nowMs >= Date.parse(addUtcCalendarMonths(validFrom, 1))) {
      errors.validFrom = 'Valid from must place the current time inside the first UTC calendar month.'
    }
  }

  let validTo: string | null = null
  if (draft.validTo) {
    try { validTo = utcInputToInstant(draft.validTo) } catch { errors.validTo = 'Enter a valid optional date and time declared in UTC.' }
    if (validFrom && validTo) {
      const fromMatch = UTC_INSTANT.exec(validFrom)!
      const toMatch = UTC_INSTANT.exec(validTo)!
      const months = (Number(toMatch[1]) - Number(fromMatch[1])) * 12 +
        Number(toMatch[2]) - Number(fromMatch[2])
      if (Date.parse(validTo) <= nowMs || months < 1 || addUtcCalendarMonths(validFrom, months) !== validTo) {
        errors.validTo = 'Valid to must be a future UTC calendar-month boundary derived from Valid from.'
      }
    }
  }

  if (Object.keys(errors).length || !validFrom || requestsPerMinute === null ||
      concurrentAiOperations === null) return { errors, material: null }
  return {
    errors,
    material: {
      planName: draft.planName,
      cycleCreditAmount: draft.cycleCreditAmount,
      validFrom,
      validTo,
      changeEffectivePolicy: 'immediate',
      prorationPolicy: 'replace',
      unusedCreditPolicy: 'rollover',
      entitlements: {
        schemaVersion: 1,
        rateLimits: { requestsPerMinute, concurrentAiOperations },
        featureFlags: {
          contentGeneration: draft.contentGeneration,
          imageGeneration: draft.imageGeneration,
        },
      },
    },
  }
}

interface SubscriptionCreationFormProps {
  clientId: string
  onConfirm: (material: CreateBillingSubscriptionMaterial) => void | Promise<void>
  now?: () => number
  disabled?: boolean
  draft?: SubscriptionDraft
  onDraftChange?: (draft: SubscriptionDraft) => void
  onPreconfirm?: () => Promise<boolean>
  serverValidationError?: boolean
}

export function SubscriptionCreationForm({
  clientId, onConfirm, now = Date.now, disabled = false, draft: controlledDraft,
  onDraftChange, onPreconfirm, serverValidationError = false,
}: SubscriptionCreationFormProps) {
  const [localDraft, setLocalDraft] = useState<SubscriptionDraft>(EMPTY_SUBSCRIPTION_DRAFT)
  const draft = controlledDraft ?? localDraft
  const [errors, setErrors] = useState<DraftErrors>({})
  const [review, setReview] = useState<CreateBillingSubscriptionMaterial | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const confirmingRef = useRef(false)
  const focusSummaryRef = useRef(false)

  useEffect(() => {
    if (focusSummaryRef.current && Object.keys(errors).length > 0) {
      focusSummaryRef.current = false
      summaryRef.current?.focus()
    }
  }, [errors])

  useEffect(() => {
    if (serverValidationError) summaryRef.current?.focus()
  }, [serverValidationError])

  useEffect(() => {
    const clearSensitiveForm = () => {
      if (!controlledDraft) setLocalDraft(EMPTY_SUBSCRIPTION_DRAFT)
      onDraftChange?.(EMPTY_SUBSCRIPTION_DRAFT)
      setReview(null)
      setErrors({})
    }
    window.addEventListener('auth:cleared', clearSensitiveForm)
    window.addEventListener('auth:refreshed', clearSensitiveForm)
    return () => {
      window.removeEventListener('auth:cleared', clearSensitiveForm)
      window.removeEventListener('auth:refreshed', clearSensitiveForm)
    }
  }, [controlledDraft, onDraftChange])

  const setText = (field: keyof SubscriptionDraft, value: string | boolean) => {
    const next = { ...draft, [field]: value }
    if (!controlledDraft) setLocalDraft(next)
    onDraftChange?.(next)
  }
  const focusField = (field: DraftField) => {
    const target = field === 'features' ? 'subscription-contentGeneration' : `subscription-${field}`
    document.getElementById(target)?.focus()
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = validateSubscriptionDraft(draft, now())
    focusSummaryRef.current = !result.material
    setErrors(result.errors)
    if (!result.material) {
      return
    }
    if (onPreconfirm) {
      void onPreconfirm().then((ready) => { if (ready) setReview(result.material) })
      return
    }
    setReview(result.material)
  }
  const confirm = () => {
    if (!review || confirmingRef.current) return
    confirmingRef.current = true
    setReview(null)
    void Promise.resolve().then(() => onConfirm(review)).finally(() => { confirmingRef.current = false })
  }

  return (
    <section aria-labelledby="create-subscription-heading" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <h2 id="create-subscription-heading" className="text-lg font-semibold text-gray-950">Create subscription</h2>
      <p className="mt-1 text-sm text-gray-600">All dates and monthly boundaries are evaluated in UTC.</p>
      <p id="subscription-form-constraints" className="mt-1 text-sm text-gray-600">Required fields use the browser required state. Amounts allow four decimal places; select at least one feature.</p>
      {(Object.keys(errors).length > 0 || serverValidationError) && (
        <div ref={summaryRef} tabIndex={-1} role="alert" aria-label="Correct the subscription form" className="state-indicator mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
          <p className="font-semibold">Correct the subscription form.</p>
          {serverValidationError && <p className="mt-1">The server rejected this request as invalid without assigning errors to individual fields. Review the retained values.</p>}
          <ul className="mt-2 list-disc pl-5">
            {Object.entries(errors).map(([rawField, message]) => {
              const field = rawField as DraftField
              return <li key={field}><a href={`#subscription-${field === 'features' ? 'contentGeneration' : field}`} onClick={() => focusField(field)} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">{FIELD_LABELS[field]}: {message}</a></li>
            })}
          </ul>
        </div>
      )}
      <form onSubmit={submit} noValidate className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField field="planName" label="Plan name" value={draft.planName} error={errors.planName} disabled={disabled} required onChange={(value) => setText('planName', value)} />
        <TextField field="cycleCreditAmount" label="Cycle credit amount" value={draft.cycleCreditAmount} error={errors.cycleCreditAmount} inputMode="decimal" disabled={disabled} required onChange={(value) => setText('cycleCreditAmount', value)} />
        <TextField field="requestsPerMinute" label="Requests per minute" value={draft.requestsPerMinute} error={errors.requestsPerMinute} inputMode="numeric" disabled={disabled} required onChange={(value) => setText('requestsPerMinute', value)} />
        <TextField field="concurrentAiOperations" label="Concurrent AI operations" value={draft.concurrentAiOperations} error={errors.concurrentAiOperations} inputMode="numeric" disabled={disabled} required onChange={(value) => setText('concurrentAiOperations', value)} />
        <fieldset aria-invalid={Boolean(errors.features)} aria-describedby={errors.features ? 'subscription-features-error' : 'subscription-form-constraints'} disabled={disabled} className="min-w-0 rounded-md border border-gray-300 p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-medium text-gray-800">Feature access (required)</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox field="contentGeneration" label="Content generation" checked={draft.contentGeneration} onChange={(checked) => setText('contentGeneration', checked)} />
            <Checkbox field="imageGeneration" label="Image generation" checked={draft.imageGeneration} onChange={(checked) => setText('imageGeneration', checked)} />
          </div>
          {errors.features && <p id="subscription-features-error" className="mt-1 text-sm text-red-700">{errors.features}</p>}
        </fieldset>
        <TextField field="validFrom" label="Valid from (UTC)" value={draft.validFrom} error={errors.validFrom} type="datetime-local" disabled={disabled} required onChange={(value) => setText('validFrom', value)} />
        <TextField field="validTo" label="Valid to (UTC, optional)" value={draft.validTo} error={errors.validTo} type="datetime-local" disabled={disabled} onChange={(value) => setText('validTo', value)} />
        <div className="rounded-md bg-gray-50 p-3 sm:col-span-2" aria-label="Locked subscription policies">
          <p className="text-sm font-semibold text-gray-950">Locked subscription behavior</p>
          <dl className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="font-medium text-gray-600">Change timing</dt><dd>Immediate</dd></div>
            <div><dt className="font-medium text-gray-600">Proration</dt><dd>Replace</dd></div>
            <div><dt className="font-medium text-gray-600">Unused credits</dt><dd>Rollover</dd></div>
          </dl>
          <p className="mt-2 text-sm text-gray-700">Monthly credits renewed by UTC calendar month from the subscription start.</p>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={disabled} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">Review subscription</button>
        </div>
      </form>

      <Modal isOpen={Boolean(review)} onClose={() => setReview(null)} title="Confirm subscription creation" size="lg" footer={review && <div className="flex flex-wrap justify-end gap-3"><button type="button" data-modal-initial-focus onClick={() => setReview(null)} className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Cancel</button><button type="button" onClick={confirm} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Confirm creation</button></div>}>
        {review && <ReviewDetails clientId={clientId} material={review} />}
      </Modal>
    </section>
  )
}

function TextField({ field, label, value, error, onChange, type = 'text', inputMode, disabled, required = false }: {
  field: keyof SubscriptionDraft
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  disabled: boolean
  required?: boolean
}) {
  const id = `subscription-${field}`
  return <div className="min-w-0"><label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label><input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : 'subscription-form-constraints'} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:bg-gray-100" />{error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}</div>
}

function Checkbox({ field, label, checked, onChange }: {
  field: 'contentGeneration' | 'imageGeneration'
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = `subscription-${field}`
  return <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-800"><input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" />{label}</label>
}

function ReviewDetails({ clientId, material }: {
  clientId: string
  material: CreateBillingSubscriptionMaterial
}) {
  return <div className="min-w-0 text-sm"><p className="text-gray-700">This write is immediate. Verify the immutable operation material before confirming. Unused credits remain owned and carry forward into later cycles.</p><dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2"><ReviewValue label="Client" value={clientId} /><ReviewValue label="Plan" value={material.planName} /><ReviewValue label="Cycle credits" value={material.cycleCreditAmount} /><ReviewValue label="Valid from" value={material.validFrom} /><ReviewValue label="Valid to" value={material.validTo ?? 'No end date'} /><ReviewValue label="Change effective policy" value="Immediate" /><ReviewValue label="Proration policy" value="Replace" /><ReviewValue label="Unused credit policy" value="Rollover" /><ReviewValue label="Cadence" value="UTC calendar month" /><ReviewValue label="Requests per minute" value={String(material.entitlements.rateLimits.requestsPerMinute)} /><ReviewValue label="Concurrent AI operations" value={String(material.entitlements.rateLimits.concurrentAiOperations)} /><ReviewValue label="Features" value={[material.entitlements.featureFlags.contentGeneration && 'Content generation', material.entitlements.featureFlags.imageGeneration && 'Image generation'].filter(Boolean).join(', ')} /></dl></div>
}

function ReviewValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-gray-600">{label}</dt><dd className="break-all text-gray-950">{value}</dd></div>
}
