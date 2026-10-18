import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { domainsApi } from '../../api/domainsApi'
import { createUuidV7 } from '../../lib/uuidV7'
import { useDomainProducts, domainKeys, assertDomainScope, invalidateDomainConsequences } from '../../queries/domainQueries'
import { blockDomainAuthority, type DomainScope } from '../../queries/domainScope'
import { clearPrivateClientScope } from '../../queries/billingQueries'
import type { DomainClaim } from '../../types/domains'
import type { ClientCapabilities } from '../../types/billing'
import { Modal } from '../shared/Modal'
import { FormErrorSummary, type FormFieldError } from '../shared/FormErrorSummary'

export const domainButton = 'min-h-11 rounded-md border border-control bg-surface px-4 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
export const domainInput = 'mt-1 min-h-11 w-full rounded-md border border-control bg-surface px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
export function DomainClaimModal({ scope, open, canReadProducts, capabilities, revalidatePolicy, onClose, onCreated }: {
  scope: DomainScope; open: boolean; canReadProducts: boolean; capabilities?: ClientCapabilities; revalidatePolicy?: () => Promise<ClientCapabilities | undefined>; onClose: () => void; onCreated: (id: string) => void
}) {
  const client = useQueryClient()
  const [host, setHost] = useState(''), [target, setTarget] = useState<'client' | 'product'>('client')
  const [method, setMethod] = useState<'cname' | 'txt'>('cname'), [productId, setProductId] = useState('')
  const [page, setPage] = useState(1), [errors, setErrors] = useState<FormFieldError[]>([])
  const [uncertain, setUncertain] = useState(false), [checkingPolicy, setCheckingPolicy] = useState(false)
  const [denied, setDenied] = useState(false), [now, setNow] = useState(performance.now())
  const retryUntil = useRef(0)
  const featureKey = target === 'client' ? 'client_domain_binding' : 'product_domain_binding'
  const featureAllowed = capabilities?.clientId === scope.clientId && capabilities.flags.some(f => f.key === featureKey && f.enabled)
  const pending = checkingPolicy
  const material = useRef<DomainClaim | null>(null), busy = useRef(false), alive = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const initialFocus = useRef<HTMLInputElement>(null), summary = useRef<HTMLDivElement>(null)
  const products = useDomainProducts(scope, page, open && target === 'product' && canReadProducts)
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort() } }, [])
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [open])
  useEffect(() => { if (errors.length) summary.current?.focus() }, [errors])
  const create = useMutation({
    mutationKey: domainKeys.command(scope, 'new', 'claim'), retry: false,
    mutationFn: async (request: DomainClaim) => {
      assertDomainScope(scope); controller.current = new AbortController()
      const result = await domainsApi.claim(scope.clientId, request, controller.current.signal)
      assertDomainScope(scope, controller.current.signal); return result
    },
  })
  const change = (action: () => void) => {
    if (busy.current || uncertain) return
    material.current = null; setErrors([]); create.reset(); action()
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy.current || denied || performance.now() < retryUntil.current) return
    const replaying = uncertain && material.current !== null
    const validation: FormFieldError[] = []
    if (!host.trim()) validation.push({ fieldId: 'domain-host', label: 'Hostname', message: 'Enter a hostname.' })
    if (!replaying && target === 'product' && (!canReadProducts || !productId)) validation.push({ fieldId: 'domain-product', label: 'Product', message: 'Choose an authorized active Product.' })
    if (validation.length) { setErrors(validation); return }
    if (!material.current) material.current = { operationId: createUuidV7(), host: host.trim(), bindingType: target,
      ...(target === 'product' && { productId }), verificationMethod: method }
    busy.current = true; setErrors([])
    let commandSent = false
    try {
      setCheckingPolicy(true)
      const policy = revalidatePolicy ? await revalidatePolicy() : capabilities
      assertDomainScope(scope)
      if (!alive.current) return
      if (!policy || policy.clientId !== scope.clientId) throw { code: 'configuration_unavailable', status: 503, message: 'Policy context could not be confirmed. The claim was not sent.' }
      // An unresolved request may already have consumed the final slot or lost
      // new-claim eligibility. The server authorizes and resolves its exact
      // receipt before applying admission checks to any new allocation.
      if (!replaying) {
        if (!policy.flags.some(f => f.key === featureKey && f.enabled)) throw { code: 'feature_not_available', status: 403, message: 'This binding type is unavailable under current policy.' }
        const limit = policy.limits.find(l => l.key === 'hostnames'), usage = policy.usage.find(u => u.key === 'hostnames')
        if (!limit || !usage) throw { code: 'configuration_unavailable', status: 503, message: 'Hostname capacity is unavailable. The claim was not sent.' }
        if (BigInt(usage.value) >= BigInt(limit.value)) throw { code: 'limit_reached', status: 409, message: 'The current hostname limit has been reached.' }
      }
      setCheckingPolicy(false)
      commandSent = true
      const result = await create.mutateAsync(material.current)
      assertDomainScope(scope, controller.current?.signal)
      if (!alive.current) return
      material.current = null; setUncertain(false)
      void invalidateDomainConsequences(client, scope, canReadProducts)
      if (alive.current) { assertDomainScope(scope); onCreated(result.domain.id) }
    } catch (error) {
      if (!alive.current || controller.current?.signal.aborted) return
      try { assertDomainScope(scope) } catch { return }
      const problem = error as ApiError
      retryUntil.current = (problem.retryAfterSeconds ?? 0) > 0
        ? performance.now() + problem.retryAfterSeconds! * 1000 : 0
      if (problem.status === 401 || problem.status === 403 && problem.code !== 'feature_not_available') {
        material.current = null; setHost(''); setProductId(''); setUncertain(false); setDenied(true)
        setErrors([{ fieldId: 'domain-claim-form', label: 'Claim access', message: 'Claim permission was lost. Private entries were cleared. Reauthorize before submitting.' }])
        void clearPrivateClientScope(client, scope.clientId); blockDomainAuthority(scope)
        if (problem.status === 401) window.dispatchEvent(new Event('auth:cleared'))
        return
      }
      // A failure of this attempt cannot settle an earlier unconfirmed POST.
      const ambiguous = replaying || commandSent && (!problem.status || problem.status >= 500 || problem.code === 'time_zone_not_set')
      if (ambiguous) void invalidateDomainConsequences(client, scope, canReadProducts)
      setUncertain(ambiguous)
      const message = problem.code === 'time_zone_not_set'
        ? 'Ask an administrator to save your timezone, then check the Domains list or retry this exact claim. It may already have committed; the original identity and entries are retained.'
        : ambiguous
        ? 'Outcome unconfirmed. This claim may already exist. Check the Domains list or retry this exact claim; the operation identity and entries are retained.'
        : problem.message || 'The claim could not be confirmed. Review the request.'
      setErrors([{ fieldId: problem.code === 'invalid_hostname' ? 'domain-host' : 'domain-claim-form', label: problem.code === 'invalid_hostname' ? 'Hostname' : 'Claim', message }])
    } finally { busy.current = false; if (alive.current) setCheckingPolicy(false) }
  }
  return <Modal isOpen={open} title="Claim domain" onClose={() => { if (!busy.current) onClose() }} closeDisabled={(create.isPending || pending)} initialFocusRef={initialFocus} footer={<div className="flex flex-wrap justify-end gap-3">
    <button type="button" className={domainButton} disabled={(create.isPending || pending)} onClick={onClose}>Close</button>
    <button type="submit" form="domain-claim-form" className={domainButton} disabled={(create.isPending || pending) || denied || now < retryUntil.current || !uncertain && (!featureAllowed || target === 'product' && (!canReadProducts || !productId || Boolean(products.error)))}>{pending ? 'Checking claim eligibility…' : create.isPending ? 'Claiming domain…' : uncertain ? 'Retry exact claim' : 'Claim domain'}</button>
  </div>}>
    <form id="domain-claim-form" tabIndex={-1} noValidate onSubmit={submit} className="min-w-0 space-y-4">
      <p className="break-all text-sm text-foreground">Active Client: {scope.clientId}. A claim reserves the hostname; ownership verification alone does not activate serving.</p>
      <FormErrorSummary ref={summary} errors={errors} />
      {!featureAllowed && <p className="text-sm text-foreground">This binding type is unavailable or its current policy could not be confirmed.</p>}
      {now < retryUntil.current && <p className="text-sm text-foreground">Server retry wait: {Math.ceil((retryUntil.current - now) / 1000)} seconds.</p>}
      {uncertain && <p className="text-sm text-warning">Entries are locked while this operation is unresolved. A refresh will use authorized reads and will never submit a new claim automatically.</p>}
      <label className="block text-sm font-medium">Hostname<input ref={initialFocus} id="domain-host" className={domainInput} value={host} maxLength={1024} required disabled={(create.isPending || pending) || uncertain || denied} aria-invalid={errors.some(e => e.fieldId === 'domain-host')} aria-describedby={errors.some(e => e.fieldId === 'domain-host') ? 'domain-host-error' : undefined} onChange={e => change(() => setHost(e.target.value))} /></label>
      {errors.filter(e => e.fieldId === 'domain-host').map(e => <p key={e.fieldId} id="domain-host-error" className="text-sm text-danger">{e.message}</p>)}
      <label className="block text-sm font-medium">Binding target<select className={domainInput} value={target} disabled={(create.isPending || pending) || uncertain || denied} onChange={e => change(() => { setTarget(e.target.value as 'client' | 'product'); setProductId(''); setPage(1) })}><option value="client">Client</option><option value="product" disabled={!canReadProducts}>Product</option></select></label>
      {!canReadProducts && <p className="text-sm text-foreground">Product selection requires products:view separately from domains:create. You can still claim an eligible Client binding.</p>}
      {target === 'product' && <div className="space-y-2"><label className="block text-sm font-medium">Product<select id="domain-product" value={productId} className={domainInput} disabled={(create.isPending || pending) || uncertain || products.isFetching || Boolean(products.error)} onChange={e => change(() => setProductId(e.target.value))}><option value="">Choose an active Product</option>{!products.error && products.data?.items.map(p => <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>)}</select></label>
        {products.isFetching && <p role="status">Loading authorized Products…</p>}{Boolean(products.error) && <p role="alert">Product selection is unavailable. Check Product access or use an eligible Client binding.</p>}
        {products.data && <nav aria-label="Product selection pages" className="flex flex-wrap items-center gap-2"><button type="button" className={domainButton} disabled={page <= 1 || products.isFetching || uncertain} onClick={() => change(() => { setPage(p => p - 1); setProductId('') })}>Previous Products</button><span>Page {page} of {products.data.totalPages || 1}</span><button type="button" className={domainButton} disabled={page >= products.data.totalPages || products.isFetching || uncertain} onClick={() => change(() => { setPage(p => p + 1); setProductId('') })}>Next Products</button></nav>}
      </div>}
      <label className="block text-sm font-medium">Verification method<select className={domainInput} value={method} disabled={(create.isPending || pending) || uncertain || denied} onChange={e => change(() => setMethod(e.target.value as 'cname' | 'txt'))}><option value="cname">CNAME</option><option value="txt">TXT</option></select></label>
      <p className="text-sm text-foreground">TXT proves ownership and requires separate routing. Apex routing depends on your DNS provider’s supported record types.</p>
      {(create.isPending || pending) && <p role="status">Claiming domain…</p>}
    </form>
  </Modal>
}
