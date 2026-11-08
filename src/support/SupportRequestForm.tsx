import { useEffect, useId, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { SUPPORT, SUPPORT_BUTTON_CLASS, SUPPORT_INPUT_CLASS } from './constants'
import type { SupportNotice, SupportProductLabel, SupportRequest } from './models'
import { useSupportDraft } from './draft'
import { productLabel, readableLabelKey, supportReadLabel, supportText } from './labels'
import { useSupportLookup } from './useSupportLookup'
import { useSupportSnapshot } from './useSupportAction'
import { SupportLookupDropdown } from './SupportLookupDropdown'
import { buildSupportRequest } from './validation'

export function SupportRequestForm({ pending, blocked, create, verify, verificationPending = false, lookupMessage, retrySeconds = 0, fieldNotice }: {
  pending: boolean; blocked: boolean; create: (request: SupportRequest) => void; verify?: () => void
  verificationPending?: boolean; lookupMessage?: string; retrySeconds?: number; fieldNotice?: SupportNotice | null
}) {
  const id = useId()
  const actor = useAuthStore(state => state.user)
  const { generation } = useSupportSnapshot()
  const { draft, update } = useSupportDraft()
  const { target, minutes, reason, reference, operations } = draft
  const selectedIds = draft.products.split(',').filter(Boolean)
  const customers = useSupportLookup(null, 0, !blocked)
  const products = useSupportLookup(target, draft.customerGeneration, !blocked)
  const labelParameters = JSON.stringify([generation, target, draft.customerGeneration, blocked])
  const labelSequence = useRef({ parameters: labelParameters, value: 0 })

  if (labelSequence.current.parameters !== labelParameters) {
    labelSequence.current = { parameters: labelParameters, value: labelSequence.current.value + 1 }
  }

  const labelKey = String(labelSequence.current.value)
  const [labels, setLabels] = useState<{ key: string; values: Record<string, SupportProductLabel> }>({ key: labelKey, values: {} })
  const verifiedLabels = labels.key === labelKey && !blocked ? labels.values : {}
  const [selectionNotice, setSelectionNotice] = useState({ key: '', message: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const feedback = useRef<HTMLDivElement>(null)
  const removals = useRef(new Map<string, HTMLButtonElement>())
  const productControl = useRef<HTMLDivElement>(null)
  const customerItems = customers.page?.items ?? []
  const [customerLabel, setCustomerLabel] = useState<{ generation: number; id: string; name: string } | null>(null)
  const selectedCustomer = !blocked && (customerItems.find(item => item.id === target)
    ?? (customerLabel?.generation === generation && customerLabel.id === target ? customerLabel : null))
  const customerName = selectedCustomer ? supportText(selectedCustomer.name) : null
  const duplicateCustomer = (name: string) => customerItems.filter(item => readableLabelKey(item.name) === readableLabelKey(name)).length > 1
  const currentProducts = (products.page?.items ?? []) as SupportProductLabel[]
  const duplicateProduct = (product: SupportProductLabel) => currentProducts.filter(item => readableLabelKey(productLabel(item)) === readableLabelKey(productLabel(product))).length > 1
  const readable = !!selectedCustomer && !duplicateCustomer(selectedCustomer.name) && selectedIds.length > 0 && selectedIds.every(product => !!verifiedLabels[product])
  const fieldError = (field: string) => fieldNotice?.field === field ? fieldNotice.message : errors[field]

  useEffect(() => {
    if (blocked) {
      setCustomerLabel(null)
    }
  }, [blocked, generation])

  useEffect(() => {
    const selected = customers.page?.items.find(item => item.id === target)

    if (!blocked && selected) {
      setCustomerLabel({ generation, ...selected })
    }
  }, [customers.page, generation, target, blocked])

  // Recover only selected IDs on explicitly visited pages, never scan the directory.
  useEffect(() => {
    if (blocked || !products.page) {
      return
    }

    const values = Object.fromEntries((products.page.items as SupportProductLabel[])
      .filter(product => selectedIds.includes(product.id) && !duplicateProduct(product)).map(product => [product.id, product]))
    setLabels(previous => ({ key: labelKey, values: { ...Object.fromEntries(Object.entries(previous.key === labelKey ? previous.values : {})
      .filter(([product]) => selectedIds.includes(product))), ...values } }))
  }, [products.page, labelKey, blocked, draft.products])

  function clearCustomer(): void {
    setCustomerLabel(null)
    update({ target: '', products: '', customerGeneration: draft.customerGeneration + 1 })
    setLabels({ key: '', values: {} })
  }

  function selectCustomer(customer: string): void {
    const label = customerItems.find(item => item.id === customer)

    if (!label) {
      return
    }

    setCustomerLabel({ generation, ...label })
    setErrors({})

    if (customer !== target) {
      update({ target: customer, products: '', customerGeneration: draft.customerGeneration + 1 })
      setLabels({ key: '', values: {} })
    }
  }

  function removeProduct(product: string, focus = false): void {
    const index = selectedIds.indexOf(product)
    setSelectionNotice({ key: labelKey, message: `${verifiedLabels[product] ? productLabel(verifiedLabels[product]) : `Selection ${index + 1}`} removed.` })
    const remaining = selectedIds.filter(value => value !== product)
    update({ products: remaining.join(',') })

    if (focus) {
      window.setTimeout(() => {
        const next = remaining[index] ?? remaining[index - 1]
        const destination = next ? removals.current.get(next) : productControl.current?.querySelector<HTMLButtonElement>('[role="combobox"]')
        destination?.focus()
      }, 0)
    }
  }

  function selectProduct(product: SupportProductLabel): void {
    if (selectedIds.includes(product.id)) {
      removeProduct(product.id)
    } else if (selectedIds.length < SUPPORT.maximumProducts) {
      update({ products: [...selectedIds, product.id].join(',') })
      setLabels({ key: labelKey, values: { ...verifiedLabels, [product.id]: product } })
    }

    setErrors({})
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next: Record<string, string> = {}

    if (!selectedCustomer) {
      next.customer = 'Choose a customer and restore its current label.'
    }

    if (!readable) {
      next.products = 'Choose 1–20 products and restore every selected label.'
    }

    if (operations.length === 0) {
      next.operations = 'Choose at least one allowed read.'
    }

    if (!/^[1-9][0-9]?$/.test(minutes) || Number(minutes) > SUPPORT.maximumMinutes) {
      next.minutes = 'Enter a whole duration from 1 to 60 minutes.'
    }

    if (!reason.trim() || Array.from(reason.trim()).length > SUPPORT.maximumReasonScalars || /\p{Cc}/u.test(reason)) {
      next.reason = 'Enter a reason of 1–500 characters without controls.'
    }

    if (!/^[A-Za-z0-9._:/#-]{1,128}$/.test(reference)) {
      next.reference = 'Enter a case reference using letters, numbers or . _ : / # -.'
    }

    setErrors(next)

    if (Object.keys(next).length > 0) {
      window.setTimeout(() => feedback.current?.focus(), 0)
      return
    }

    if (!blocked && !pending) {
      create(buildSupportRequest(target, draft.products, operations, minutes, reason, reference))
    }
  }

  function status(kind: 'customers' | 'products', lookup: ReturnType<typeof useSupportLookup>) {
    return <>
      {blocked ? <p>Verify access to load available {kind}. Selected labels are unavailable.</p> : <>
        {kind === 'products' && !target ? <p>Select a customer first</p> : <>
          {lookup.loading && <p>Loading {kind}…</p>}
          {lookup.failure && <><p>Options could not be refreshed. {lookup.failure.message}</p>
            {lookup.retrySeconds > 0 && <p aria-live="off">Try again in {lookup.retrySeconds} seconds.</p>}
            <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={lookup.retrySeconds > 0} onClick={lookup.retry}>
              {lookup.failure.status === 400 ? 'Reload options from start' : `Retry ${kind}`}
            </button></>}
          {lookup.page?.items.length === 0 && <p>{kind === 'customers' ? 'No customers available' : 'No products available for this customer'}</p>}
        </>}
      </>}
    </>
  }

  return <section className="space-y-4 break-words rounded-lg border border-line p-4">
    <h2 className="text-xl font-semibold">Request customer approval</h2>
    <p>Select one customer and 1–20 products. A current customer ClientOwner must approve the exact displayed scope.</p>
    <form onSubmit={submit} noValidate className="space-y-4">
      {blocked && <div role="status" className="space-y-2 rounded-lg border border-line bg-subtle p-3">
        <p>Verify access to load available values. Your permitted unsent input is retained.</p>
        {lookupMessage && <p>{lookupMessage}</p>}
        {verificationPending && <p>Verifying access…</p>}
        {retrySeconds > 0 && <p aria-live="off">Try again in {retrySeconds} seconds.</p>}
        {verify && <button type="button" className={SUPPORT_BUTTON_CLASS} disabled={verificationPending || retrySeconds > 0} onClick={verify}>Verify access to load options</button>}
      </div>}
      <SupportLookupDropdown label="Customer" value={customerName ?? (target ? 'Customer label unavailable — verify access' : 'Select a customer')}
        disabled={blocked} busy={customers.loading} select={selectCustomer} dismiss={customers.dismiss} resume={customers.resume}
        loadMore={customers.more} start={customers.start} page={customers.number} more={!!customers.page?.nextCursor}
        invalid={!!fieldError('customer')} errorId={`${id}-customer-error`}
        options={customerItems.map((item, index) => ({ id: item.id, label: supportText(item.name) + (duplicateCustomer(item.name) ? ` · customer ${index + 1}` : ''),
          selected: target === item.id, disabled: duplicateCustomer(item.name) }))}
        status={<>{status('customers', customers)}{customerItems.some(item => duplicateCustomer(item.name)) && <p>These customer names are indistinguishable. Ask the case owner to resolve their identity.</p>}</>} />
      <p id={`${id}-customer-error`}>{fieldError('customer')}</p>
      {customerName && <p>Identity will be verified before requesting.</p>}
      {target && <button type="button" className="min-h-11 text-primary underline" onClick={clearCustomer}>Clear customer selection</button>}
      <div ref={productControl}><SupportLookupDropdown key={draft.customerGeneration} label="Products" multiple value={`${selectedIds.length} of 20 products selected`}
        disabled={blocked || !target} busy={products.loading} select={selected => {
          const product = currentProducts.find(item => item.id === selected)

          if (product) {
            selectProduct(product)
          }
        }} dismiss={products.dismiss} resume={products.resume} loadMore={products.more} start={products.start} page={products.number} more={!!products.page?.nextCursor}
        invalid={!!fieldError('products')} errorId={`${id}-products-error`}
        options={currentProducts.map(product => ({ id: product.id, label: productLabel(product), selected: selectedIds.includes(product.id),
          disabled: duplicateProduct(product) && !selectedIds.includes(product.id) || !selectedIds.includes(product.id) && selectedIds.length >= SUPPORT.maximumProducts }))}
        status={<>{status('products', products)}
          {currentProducts.some(duplicateProduct) && <p>These product names and slugs are indistinguishable. Resolve their identity before requesting.</p>}
          {selectedIds.length === SUPPORT.maximumProducts && <p>20 product limit reached. Remove a selection to choose another product.</p>}
        </>} /></div>
      <p id={`${id}-products-error`}>{fieldError('products')}</p>
      {target && (!customerName || selectedIds.some(product => !verifiedLabels[product])) && <p>Selected item needs its current label. Open options and use Next options to restore it. An unresolved item must be restored or explicitly removed before requesting.</p>}
      <p role="status" aria-atomic="true">{!blocked && selectionNotice.key === labelKey ? selectionNotice.message : ''} {selectedIds.length} of 20 products selected</p>
      {selectedIds.length > 0 && <ul aria-label="Selected products" className="flex flex-wrap gap-2">
        {selectedIds.map((product, index) => <li key={product} className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1">
          <span className="min-w-0 break-words">{verifiedLabels[product] ? productLabel(verifiedLabels[product]) : `Selection ${index + 1}: label unavailable`}</span>
          <button ref={element => {
            if (element) {
              removals.current.set(product, element)
            } else {
              removals.current.delete(product)
            }
          }} type="button" className="min-h-11 max-w-full text-sm text-primary underline"
            aria-label={`Remove ${verifiedLabels[product] ? productLabel(verifiedLabels[product]) : `selection ${index + 1}`}`}
            onClick={() => removeProduct(product, true)}>Remove</button>
        </li>)}
      </ul>}
      <fieldset aria-describedby={`${id}-operations-error`} aria-invalid={!!errors.operations || undefined} className="min-w-0 space-y-2"><legend className="font-semibold">Allowed reads</legend>{[SUPPORT.identityRead, SUPPORT.draftRead].map(operation => <label key={operation} className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={operations.includes(operation)} onChange={event => update({ operations: event.target.checked ? [...operations, operation] : operations.filter(value => value !== operation) })} /><span>{supportReadLabel(operation)}</span>
      </label>)}</fieldset><p id={`${id}-operations-error`}>{errors.operations}</p>
      <label className="block" htmlFor={`${id}-minutes`}>Duration in minutes<input id={`${id}-minutes`} type="number" min={1} max={60} step={1} value={minutes} onChange={event => update({ minutes: event.target.value })} aria-invalid={!!errors.minutes || undefined} aria-describedby={`${id}-minutes-error`} className={SUPPORT_INPUT_CLASS} /></label><p id={`${id}-minutes-error`}>{errors.minutes}</p>
      <label className="block" htmlFor={`${id}-reason`}>Support reason<textarea id={`${id}-reason`} value={reason} onChange={event => update({ reason: event.target.value })} rows={3} aria-invalid={!!errors.reason || undefined} aria-describedby={`${id}-reason-error`} className={SUPPORT_INPUT_CLASS} /></label><p id={`${id}-reason-error`}>{errors.reason}</p>
      <label className="block" htmlFor={`${id}-case`}>Support case reference<input id={`${id}-case`} value={reference} onChange={event => update({ reference: event.target.value })} maxLength={128} aria-invalid={!!errors.reference || undefined} aria-describedby={`${id}-reference-error`} className={SUPPORT_INPUT_CLASS} /></label><p id={`${id}-reference-error`}>{errors.reference}</p>
      <section aria-label="Request preview" className="space-y-2 rounded-lg border border-line p-3"><h3 className="font-semibold">Review before requesting</h3>
        <p>Operator: {supportText(actor?.displayName)} · customer: {customerName ?? 'Choose and verify a customer'}</p>
        <p>Case: {supportText(reference, 'Enter a case reference')} · duration: {minutes} minutes</p><p>{operations.map(supportReadLabel).join(', ')}</p>
        <ul>{selectedIds.map((product, index) => <li key={product}>{verifiedLabels[product] ? productLabel(verifiedLabels[product]) : `Selection ${index + 1}: label unavailable`}</li>)}</ul>
      </section>
      {Object.keys(errors).length > 0 && <div ref={feedback} tabIndex={-1} role="alert"><p>Check the marked request fields.</p>{Object.values(errors).map(message => <p key={message}>{message}</p>)}</div>}
      {(!readable || blocked) && <p id={`${id}-submit-help`}>Restore current customer and product labels before requesting. No request will be sent during verification.</p>}
      <button type="submit" aria-describedby={`${id}-submit-help`} className={SUPPORT_BUTTON_CLASS} disabled={pending || blocked || !readable}>Request exact scope</button>
    </form>
  </section>
}
