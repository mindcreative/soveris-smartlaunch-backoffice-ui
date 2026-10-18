import type { ApiError } from '../../api/apiClient'
import { ClientCapabilitiesContractError } from '../../api/billingApi'
import type { ClientCapabilities } from '../../types/billing'

function statusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as ApiError).status : undefined
}

export function CapabilityPolicyContext({
  clientId, capabilities, isLoading, isFetching, error, onRetry, context = 'billing',
}: {
  context?: 'billing' | 'domains'
  clientId: string
  capabilities?: ClientCapabilities
  isLoading: boolean
  isFetching: boolean
  error: unknown
  onRetry: () => void
}) {
  const status = statusOf(error)
  const hidePrivateEvidence = status === 401 || status === 403 || status === 404 ||
    error instanceof ClientCapabilitiesContractError
  return (
    <section aria-labelledby="capability-policy-heading" className="rounded-lg border border-info-line bg-info-soft p-4 sm:p-6">
      <h2 id="capability-policy-heading" className="text-lg font-semibold text-foreground">Capability and policy source</h2>
      <p className="mt-1 text-sm text-foreground">{context === 'domains' ? 'Read-only domain policy for the active Client. Permissions, subscription metadata and funding are separate.' : 'Read-only access policy evidence for the selected Client. Wallet balances remain on the separate Account page.'}</p>
      {isLoading && !capabilities && <p role="status" className="state-indicator mt-3 text-sm">Loading policy evidence…</p>}
      {Boolean(error) && !capabilities && (
        <div role="alert" className="state-indicator mt-3 rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger">
          <p>{status === 403 ? 'Policy evidence is not permitted.' : status === 404 ? 'Policy evidence is not available for this Client.' : 'Policy evidence could not be validated.'}</p>
          {status === 503 && <p className="mt-2">{context === 'domains' ? 'Policy context is unavailable. Independently authorized domain status and release remain available.' : 'Usage and operation decisions are unavailable. Tier changes use separate fresh subscription and server preview checks.'}</p>}
          {status !== 403 && <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-md border border-danger-line bg-surface px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Retry policy context</button>}
        </div>
      )}
      {!hidePrivateEvidence && capabilities && capabilities.clientId === clientId && (
        <>
          {(Boolean(error) || isFetching) && <p role="status" className="state-indicator mt-3 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">{error ? 'The last validated policy evidence may be stale.' : 'Refreshing policy evidence…'}</p>}
          {context === 'domains' && capabilities.classification === 'soveris_internal' && !capabilities.subscription && <p className="mt-3 text-sm text-foreground">Internal feature access does not require a subscription. Resource limits and permissions still apply.</p>}
          {context === 'domains' && capabilities.policyVersion.startsWith('fixture-') && <p className="mt-3 text-sm text-foreground">Local fixture policy. These values are not approved commercial limits.</p>}
          <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Value label="Classification" value={capabilities.classification} />
            <Value label="Classification source" value={capabilities.classificationSource} />
            <Value label="Classification revision" value={capabilities.classificationRevision} mono />
            <Value label="Policy source" value={capabilities.policySource} />
            <Value label="Policy version" value={capabilities.policyVersion} />
            <Value label="Evaluated at" value={capabilities.evaluatedAt} mono />
            <Value label="Next boundary" value={capabilities.nextBoundary ?? 'Not applicable'} mono />
            <Value label="Stored tier" value={capabilities.subscription?.storedTier ?? 'No stored subscription'} />
            <Value label="Effective tier" value={capabilities.subscription?.effectiveTier ?? 'No effective paid tier'} />
            <Value label="Tier revision" value={capabilities.subscription?.tierRevision ?? 'Not applicable'} mono />
            <Value label="Subscription status" value={capabilities.subscription?.status ?? 'Not applicable'} />
          </dl>
          <h3 className="mt-5 font-semibold text-foreground">Capability flags</h3>
          <ul className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            {capabilities.flags.filter(flag => context !== 'domains' || flag.key === 'client_domain_binding' || flag.key === 'product_domain_binding').map((flag) => <li key={flag.key} className="rounded-md border border-info-line bg-surface p-3"><span className="break-all font-medium">{flag.key}</span>: {flag.enabled ? 'enabled' : 'disabled'}</li>)}
          </ul>
          <h3 className="mt-5 font-semibold text-foreground">Limits and current usage</h3>
          {capabilities.limits.length === 0 ? <p className="mt-2 text-sm text-foreground">No finite limits apply.</p> : (
            <ul className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
              {capabilities.limits.filter(limit => context !== 'domains' || limit.key === 'hostnames' || limit.key === 'active_products').map((limit) => {
                const usage = capabilities.usage.find((item) => item.key === limit.key)
                return <li key={limit.key} className="rounded-md border border-info-line bg-surface p-3"><span className="break-all font-medium">{limit.key}</span>: {usage?.value ?? 'Not measured'} / {limit.value} {limit.unit}</li>
              })}
            </ul>
          )}
          {context !== 'domains' && <><h3 className="mt-5 font-semibold text-foreground">Operation decisions</h3>
          <ul className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            {capabilities.operations.map((operation) => <li key={operation.key} className="rounded-md border border-info-line bg-surface p-3"><span className="break-all font-medium">{operation.key}</span>: {operation.outcome}{operation.denialConditions.length > 0 ? ` — ${operation.denialConditions.join(', ')}` : ''}</li>)}
          </ul></>}
        </>
      )}
    </section>
  )
}

function Value({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="font-medium text-muted">{label}</dt><dd className={`break-all text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd></div>
}
