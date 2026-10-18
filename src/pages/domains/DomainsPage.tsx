import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { blockDomainAuthority, domainScopeCurrent, useDomainScope, type DomainScope } from '../../queries/domainScope'
import { clearPrivateClientScope, useClientCapabilities } from '../../queries/billingQueries'
import { CapabilityPolicyContext } from '../../components/billing/CapabilityPolicyContext'
import { DomainDetail } from '../../components/domains/DomainDetail'
import { useDomains, domainKeys } from '../../queries/domainQueries'
import { DomainClaimModal, domainButton } from '../../components/domains/DomainClaimModal'
import { Badge } from '../../components/shared/Badge'
import { EmptyState } from '../../components/shared/EmptyState'
import { DataTable } from '../../components/shared/DataTable'
import { Forbidden } from '../../components/shared/ErrorDisplay'
import type { ApiError } from '../../api/apiClient'
import type { Domain } from '../../types/domains'

function Summary({ domain }: { domain: Domain }) {
  return <div className="flex flex-wrap gap-2"><Badge>Ownership: {domain.ownership.status}</Badge><Badge variant="neutral">Routing: {domain.routing.status}</Badge><Badge variant="neutral">TLS: {domain.tls.status}</Badge></div>
}
export default function DomainsPage() {
  const scope = useDomainScope()
  const { hasPermission } = useAuth()
  if (scope.blocked || !scope.clientId || !scope.actorId || !hasPermission('domains:view')) return <Forbidden message="A valid active Client and domains:view are required." />
  return <DomainsScope key={`${scope.actorId}:${scope.clientId}:${scope.generation}`} scope={scope} />
}
function DomainsScope({ scope }: { scope: DomainScope }) {
  const { domainId = '' } = useParams(), navigate = useNavigate(), client = useQueryClient()
  const { hasPermission } = useAuth()
  const [page, setPage] = useState(1), [claimOpen, setClaimOpen] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const capabilities = useClientCapabilities(scope.clientId)
  const list = useDomains(scope, page, !domainId)
  useEffect(() => { heading.current?.focus() }, [domainId])
  useEffect(() => () => {
    const key = domainKeys.scope(scope)
    void client.cancelQueries({ queryKey: key })
    client.removeQueries({ queryKey: key })
    for (const mutation of client.getMutationCache().getAll())
      if (key.every((part, i) => mutation.options.mutationKey?.[i] === part)) client.getMutationCache().remove(mutation)
  }, [scope.actorId, scope.clientId, scope.generation, client])
  const query = list
  const problem = (!domainId ? query.error : null) as ApiError | null
  const policyStatus = (capabilities.error as ApiError | null)?.status
  useEffect(() => {
    if (!(policyStatus === 401 || policyStatus === 403 || policyStatus === 404 || problem?.status === 401 || problem?.status === 403) || !domainScopeCurrent(scope)) return
    void clearPrivateClientScope(client, scope.clientId)
    blockDomainAuthority(scope)
  }, [policyStatus, problem?.status, client, scope.actorId, scope.clientId, scope.generation])
  if (policyStatus === 401 || policyStatus === 403 || policyStatus === 404) return <Forbidden message="The current Client authorization changed. Protected domain state was cleared." />
  if (problem?.status === 401 || problem?.status === 403) return <Forbidden message="Current domain access is unavailable. Reauthorize before continuing." />
  const domains = list.data?.value.items ?? []
  const totalPages = list.data?.value.totalPages || 1
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 ref={heading} tabIndex={-1} className="text-xl font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">Domains</h1><p className="mt-1 break-all text-sm text-foreground">Active Client: {scope.clientId}</p></div>{!domainId && hasPermission('domains:create') && <button type="button" className={domainButton} onClick={() => setClaimOpen(true)}>Claim domain</button>}</div>
    <CapabilityPolicyContext context="domains" clientId={scope.clientId} capabilities={capabilities.data} isLoading={capabilities.isLoading} isFetching={capabilities.isFetching} error={capabilities.error} onRetry={() => void capabilities.refetch()} />
    {domainId && <Link to="/domains" className={`inline-flex items-center ${domainButton}`}>Back to Domains</Link>}
    {!domainId && query.isFetching && <p role="status">{query.data ? 'Checking current domains…' : 'Loading domains…'}</p>}
    {problem && <div role="alert" className="rounded-md border border-danger-line bg-danger-soft p-4 text-danger"><p>{problem.status === 404 ? 'This domain is unavailable in the active Client. Absence does not confirm cleanup.' : problem.message || 'Domain information is unavailable.'}</p><button type="button" className={`mt-2 ${domainButton}`} onClick={() => void query.refetch()}>Check status</button></div>}
    {!domainId && !list.isPending && !problem && <>
      {domains.length === 0 ? <EmptyState title="No domain claims" description="This Client has no domain claims on this page. A new claim reserves a hostname while ownership and routing are checked." /> : <>
      <div className="hidden md:block"><DataTable caption="Domain claims for active Client" data={domains.map(domain => ({ id: domain.id, host: domain.host, domain }))} columns={[
        { key: 'host', label: 'Hostname', render: (_, row) => <Link className="inline-flex min-h-11 items-center break-all font-medium text-primary underline" to={`/domains/${row.id}`}>{row.host}</Link> },
        { key: 'domain', label: 'Independent states', render: (_, row) => <Summary domain={row.domain} /> },
      ]} /></div>
      <ul aria-label="Domain claims for active Client" className="space-y-3 md:hidden">{domains.map(domain => <li key={domain.id} className="rounded-lg border border-control bg-surface p-4"><Link to={`/domains/${domain.id}`} className="inline-flex min-h-11 items-center break-all font-medium text-primary underline">{domain.host}</Link><Summary domain={domain} /></li>)}</ul>
      </>}
      <nav aria-label="Domain pages" className="flex flex-wrap items-center gap-3"><button type="button" className={domainButton} disabled={page <= 1 || list.isFetching} onClick={() => setPage(p => p - 1)}>Previous page</button><p>{page > totalPages ? `Page ${page} is empty; ${totalPages} earlier ${totalPages === 1 ? 'page is' : 'pages are'} available.` : `Page ${page} of ${totalPages}`}</p><button type="button" className={domainButton} disabled={page >= totalPages || list.isFetching} onClick={() => setPage(p => p + 1)}>Next page</button><button type="button" className={domainButton} disabled={list.isFetching} onClick={() => void list.refetch()}>Refresh domains</button></nav>
    </>}
    {domainId && <DomainDetail key={domainId} scope={scope} id={domainId} />}
    {hasPermission('domains:create') && <DomainClaimModal scope={scope} open={claimOpen} canReadProducts={hasPermission('products:view')} capabilities={capabilities.error ? undefined : capabilities.data} revalidatePolicy={async () => { const result = await capabilities.refetch(); if (result.error) throw result.error; return result.data }} onClose={() => setClaimOpen(false)} onCreated={id => { setClaimOpen(false); navigate(`/domains/${id}`) }} />}
  </div>
}
