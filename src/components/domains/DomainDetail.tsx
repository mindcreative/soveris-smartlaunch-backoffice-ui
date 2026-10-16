import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { DomainScope } from '../../queries/domainScope'
import { useDomainTracker } from '../../queries/useDomainTracker'
import { domainIsActive } from '../../queries/domainTracker'
import { invalidateDomainConsequences } from '../../queries/domainQueries'
import { domainScopeCurrent } from '../../queries/domainScope'
import { useQueryClient } from '@tanstack/react-query'
import { DomainReleasePanel } from './DomainReleasePanel'
import { useDomainActions } from '../../queries/useDomainActions'
import { Badge } from '../shared/Badge'
import { Forbidden } from '../shared/ErrorDisplay'
import { Modal } from '../shared/Modal'
import { DomainInstructions, DomainTime } from './DomainInstructions'
import { domainButton } from './DomainClaimModal'

export function DomainDetail({ scope, id }: { scope: DomainScope; id: string }) {
  const { hasPermission } = useAuth()
  const client = useQueryClient()
  const { tracker, state, now } = useDomainTracker(scope, id)
  const actions = useDomainActions(scope, id, tracker, hasPermission('products:view'))
  const [primaryIntent, setPrimaryIntent] = useState<{ revision: string; host: string } | null>(null)
  const [releaseIntent, setReleaseIntent] = useState<{ host: string; target: string; primary: boolean } | null>(null)
  const receipt = state.value?.kind === 'release' ? state.value.release : null
  const receiptState = useRef('')
  useEffect(() => {
    if (!receipt || receiptState.current === `${receipt.releaseId}:${receipt.state}`) return
    receiptState.current = `${receipt.releaseId}:${receipt.state}`
    setPrimaryIntent(null); setReleaseIntent(null)
    void invalidateDomainConsequences(client, scope, hasPermission('products:view'))
  }, [receipt, client, scope.actorId, scope.clientId, scope.generation])
  const cancel = useRef<HTMLButtonElement>(null)
  const cancelRelease = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (state.phase === 'denied' || state.phase === 'not_found' || state.phase === 'contract_error') { setPrimaryIntent(null); setReleaseIntent(null) } }, [state.phase])
  if (state.phase === 'denied') return <Forbidden message="Current domain permission is unavailable. Protected state and confirmations were cleared." />
  const domain = state.value?.kind === 'domain' ? state.value.domain : null
  const fresh = Boolean(domain && now < state.freshUntil)
  const active = domainIsActive(state, now)
  const waiting = Math.max(state.embargoUntil, actions.retryUntil)
  const commandBlocked = actions.pending || now < state.embargoUntil || !fresh
  return <div className="min-w-0 space-y-5">
    <p role="status" className="rounded-md border border-gray-300 bg-white p-3 text-sm">{actions.message || state.message || 'Loading domain…'}</p>
    {state.phase === 'unavailable' || state.phase === 'timeout' || state.phase === 'not_found' || state.phase === 'contract_error' ? <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{state.message}</p> : null}
    <div className="flex flex-wrap items-center gap-3"><button type="button" className={domainButton} disabled={state.phase === 'loading' || state.phase === 'tracking' || now < state.embargoUntil || actions.pending} onClick={() => tracker.start()}>Check status</button><p className="text-sm text-gray-700">Status requests: {state.attempts} / 60. {state.receivedAt === null ? 'No current response yet.' : `Last checked ${Math.max(0, Math.floor((now - state.receivedAt) / 1000))} seconds ago.`}</p></div>
    {now < waiting && <p className="text-sm text-gray-700">Server retry wait: {Math.ceil((waiting - now) / 1000)} seconds.</p>}
    {receipt && <DomainReleasePanel receipt={receipt} />}
    {domain && <section aria-label="Domain details" className="min-w-0 space-y-5 rounded-lg border border-gray-300 bg-white p-4 sm:p-6">
      <h2 className="break-all text-lg font-semibold">{domain.host}</h2>
      <p className="break-all text-sm">Binding target: {domain.bindingType === 'client' ? `Client ${scope.clientId}` : `Product ${domain.productId}`}. Revision {domain.revision}.</p>
      <div className="flex flex-wrap gap-2"><Badge variant={active ? 'success' : 'neutral'}>{active ? 'Active' : fresh ? 'Not currently Active' : 'Serving confirmation stale'}</Badge><Badge>Ownership: {domain.ownership.status}</Badge><Badge variant="neutral">Routing: {domain.routing.status}</Badge><Badge variant="neutral">TLS: {domain.tls.status}</Badge>{domain.isPrimary && <Badge variant="info">Primary preference</Badge>}</div>
      {!fresh && <p role="status" className="text-sm text-amber-950">Serving confirmation is stale. Check current status before an action. Ownership verified does not mean Active.</p>}
      {domain.authority && <section aria-label="Current domain policy" className="space-y-3 rounded-md border border-gray-300 p-4 text-sm">
        <p>Binding eligibility: {domain.authority.binding.state}; {domain.authority.binding.selected ? 'selected by server' : 'not selected by server'}. {domain.authority.binding.reason?.replace(/_/g, ' ')}</p>
        {domain.authority.product && <p>Product eligibility: {domain.authority.product.state}; {domain.authority.product.selected ? 'selected by server' : 'not selected by server'}. {domain.authority.product.reason?.replace(/_/g, ' ')}</p>}
        <p>Serving reason: {domain.authority.servingReason.replace(/_/g, ' ')}. {domain.authority.affectedResourceCount === null ? 'Affected-resource count unavailable.' : `${domain.authority.affectedResourceCount} affected resources in this projection.`}</p>
        <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><DomainTime label="Authority evaluated at" value={domain.authority.evaluatedAt} /><DomainTime label="Next authority boundary" value={domain.authority.nextBoundary} /><DomainTime label="Binding policy loss began" value={domain.authority.binding.lossAt} /><DomainTime label="Binding policy access deadline" value={domain.authority.binding.accessUntil} />{domain.authority.product && <><DomainTime label="Product policy loss began" value={domain.authority.product.lossAt} /><DomainTime label="Product policy access deadline" value={domain.authority.product.accessUntil} /></>}</dl>
        <p>Policy grace applies only to an existing active route under a qualifying loss. Its exact deadline is separate from any earlier proof or TLS expiry. Eligibility restoration still requires current ownership, routing and TLS to restore serving. Resource selection and deadlines are server-owned.</p>
      </section>}
      <div className="space-y-3"><div className="flex flex-wrap gap-3">
        {hasPermission('domains:verify') && <><button type="button" className={domainButton} disabled={commandBlocked || now < actions.retryUntil || !domain.authority?.canVerify || now < state.cooldownUntil} onClick={() => void actions.verify()}>Verify now</button><button type="button" className={domainButton} disabled={commandBlocked || now < actions.retryUntil || (!actions.unresolvedRetry && !domain.authority?.canRetry)} onClick={() => void actions.retry()}>{actions.unresolvedRetry ? 'Reconcile original Retry' : 'Retry verification'}</button></>}
        {hasPermission('domains:update') && <button type="button" className={domainButton} disabled={commandBlocked || now < actions.primaryUntil || !domain.authority?.canSetPrimary || domain.isPrimary} onClick={() => setPrimaryIntent({ revision: domain.revision, host: domain.host })}>Make primary</button>}
      </div>
        {hasPermission('domains:verify') && <p className="text-sm text-gray-700">Verify: {domain.authority?.verifyReason?.replace(/_/g, ' ') ?? 'currently eligible'}. Retry: {domain.authority?.retryReason?.replace(/_/g, ' ') ?? 'currently eligible'}. {now < state.cooldownUntil ? `Persisted Verify cooldown: ${Math.ceil((state.cooldownUntil - now) / 1000)} seconds.` : ''}</p>}
        {hasPermission('domains:update') && domain.authority?.primaryReason && <p className="text-sm text-gray-700">Primary selection unavailable: {domain.authority.primaryReason.replace(/_/g, ' ')}.</p>}
      </div>
      {hasPermission('domains:delete') && <div className="space-y-2 border-t border-gray-300 pt-4"><button type="button" className={domainButton} disabled={actions.pending || now < actions.releaseUntil} onClick={() => setReleaseIntent({ host: domain.host, target: domain.bindingType === 'client' ? `Client ${scope.clientId}` : `Product ${domain.productId}`, primary: domain.isPrimary })}>Release domain</button><p className="text-sm text-gray-700">Release remains available with delete authority after feature, proof or TLS eligibility expires. Cleanup completion is confirmed separately.</p></div>}
      <DomainInstructions domain={domain} />
    </section>}
    <Modal isOpen={!receipt && primaryIntent !== null} title="Make domain primary" onClose={() => { if (!actions.pending) setPrimaryIntent(null) }} closeDisabled={actions.pending} initialFocusRef={cancel} footer={<div className="flex flex-wrap justify-end gap-3"><button ref={cancel} type="button" className={domainButton} disabled={actions.pending} onClick={() => setPrimaryIntent(null)}>Cancel</button><button type="button" className={domainButton} disabled={commandBlocked || !domain?.authority?.canSetPrimary || primaryIntent?.revision !== domain?.revision} onClick={() => { if (primaryIntent) void actions.primary(primaryIntent.revision).then(() => { if (domainScopeCurrent(scope)) setPrimaryIntent(null) }) }}>Confirm primary</button></div>}>
      <p className="break-all">Client {scope.clientId}: make {primaryIntent?.host} primary for this {domain?.bindingType} binding target. This changes the preferred canonical URL and replaces the current primary preference. The server rechecks revision and eligibility.</p>
      {!fresh && <p className="mt-3">Status is stale. Close this dialog and Check status, then review a new intent.</p>}
    </Modal>
    <Modal isOpen={!receipt && releaseIntent !== null} title="Release domain" onClose={() => { if (!actions.pending) setReleaseIntent(null) }} closeDisabled={actions.pending} initialFocusRef={cancelRelease} footer={<div className="flex flex-wrap justify-end gap-3"><button ref={cancelRelease} type="button" className={domainButton} disabled={actions.pending} onClick={() => setReleaseIntent(null)}>Cancel</button><button type="button" className={domainButton} disabled={actions.pending || now < actions.releaseUntil || !hasPermission('domains:delete')} onClick={() => void actions.release().then(() => { if (domainScopeCurrent(scope)) setReleaseIntent(null) })}>{actions.pending ? 'Releasing domain…' : 'Confirm release'}</button></div>}>
      <p className="break-all">Client {scope.clientId}: release {releaseIntent?.host}, bound to {releaseIntent?.target}.</p>
      <p className="mt-3">Serving is disabled immediately after acceptance. {releaseIntent?.primary ? 'This removes the primary preference.' : 'The server determines current primary consequences.'} Canonical URLs may change or become unavailable and will be refreshed from authorized server reads.</p>
      <p className="mt-3">Cleanup can take longer. The hostname reservation and applicable hostname capacity stay consumed until confirmed release. This action cannot cancel cleanup. A fresh claim needs a new identity and proof.</p>
      <p className="mt-3">If the reply is lost, Check status for this same immutable identity. Absence from ordinary detail never confirms cleanup.</p>
    </Modal>
  </div>
}
