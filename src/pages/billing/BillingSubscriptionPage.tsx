import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { BillingContractError, BillingSubscriptionContractError, ClientCapabilitiesContractError } from '../../api/billingApi'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { LocalSubscriptionCreationWorkspace, LocalSubscriptionCreatedNotice } from '../../components/billing/LocalSubscriptionCreationWorkspace'
import type { LocalSubscriptionReceipt } from '../../api/localSubscriptionApi'
import { SubscriptionLifecycleControlsView } from '../../components/billing/SubscriptionLifecycleControls'
import { CapabilityPolicyContext } from '../../components/billing/CapabilityPolicyContext'
import { ResourceAccessConsequenceTimeline } from '../../components/billing/ResourceAccessConsequenceTimeline'
import { SubscriptionTierControls } from '../../components/billing/SubscriptionTierControls'
import { Breadcrumbs, EmptyState, ErrorDisplay, Forbidden, LoadingSpinner } from '../../components/shared'
import { useAuth } from '../../hooks/useAuth'
import { useSubscriptionLifecycle } from '../../hooks/useSubscriptionLifecycle'
import { canonicalizeGuid } from '../../lib/guid'
import {
  clearPrivateClientScope,
  useClientCapabilities,
  useResourceAccessConsequences,
  useBillingAccount,
  useBillingSubscriptions,
} from '../../queries/billingQueries'
import type { BillingSubscriptionItem, BillingSubscriptionState } from '../../types/billing'
import { SavedZoneTime } from '../../timezone/SavedZoneTime'

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status
    : undefined
}

function SubscriptionFrame({ clientId, headingRef, children }: {
  clientId: string
  headingRef?: React.RefObject<HTMLHeadingElement | null>
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto min-w-0 max-w-7xl break-words">
      <Breadcrumbs items={[
        { label: 'Billing', href: '/billing' },
        { label: 'Subscriptions' },
        { label: `Selected Client ${clientId}` },
      ]} />
      <BillingWorkspaceNav clientId={clientId} />
      <div className="mb-6 min-w-0">
        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="text-2xl font-bold text-gray-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          Subscriptions
        </h1>
        <p className="mt-1 break-all text-sm text-gray-600">Selected Client: {clientId}</p>
      </div>
      {children}
    </div>
  )
}

function CurrentSubscription({ subscription, state, hasNextPage, isLoadingMore, continuationError, onLoadMore }: {
  subscription: BillingSubscriptionItem
  state: BillingSubscriptionState
  hasNextPage: boolean
  isLoadingMore: boolean
  continuationError?: unknown
  onLoadMore: () => Promise<void>
}) {
  return (
    <section aria-labelledby="current-subscription-heading" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <h2 id="current-subscription-heading" className="text-lg font-semibold text-gray-950">Current subscription</h2>
      <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <div><dt className="text-sm font-medium text-gray-600">Plan name</dt><dd className="break-words text-gray-950">{subscription.planName}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Status</dt><dd className="text-gray-950">{subscription.status}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Stored subscription tier</dt><dd className="text-gray-950">{subscription.subscriptionTier}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Tier revision</dt><dd className="font-mono text-gray-950">{subscription.tierRevision}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Cycle credits</dt><dd className="break-all text-gray-950">{subscription.cycleCreditAmount}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Valid from</dt><dd className="break-all text-gray-950"><SavedZoneTime value={subscription.validFrom} /></dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Valid to</dt><dd className="break-all text-gray-950">{subscription.validTo ? <SavedZoneTime value={subscription.validTo} /> : 'No end date'}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Change timing</dt><dd className="text-gray-950">{subscription.changeEffectivePolicy}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Proration</dt><dd className="text-gray-950">{subscription.prorationPolicy}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Unused credits</dt><dd className="text-gray-950">Rollover</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Requests per minute</dt><dd className="text-gray-950">{subscription.entitlements.rateLimits.requestsPerMinute}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Concurrent AI operations</dt><dd className="text-gray-950">{subscription.entitlements.rateLimits.concurrentAiOperations}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Content generation</dt><dd className="text-gray-950">{subscription.entitlements.featureFlags.contentGeneration ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Image generation</dt><dd className="text-gray-950">{subscription.entitlements.featureFlags.imageGeneration ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      <p className="mt-4 text-sm text-gray-600">The server derives monthly billing boundaries from the original subscription instant.</p>
      {(subscription.pendingImmediateDebit || subscription.immediateChangeContext || state.pendingChange ||
        state.pendingImmediateDebit || state.immediateChangeContext) && (
        <p role="status" className="state-indicator mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Additional subscription change context is present and is read-only on this page.
        </p>
      )}
      {state.pendingTierChange && <div role="status" className="state-indicator mt-4 rounded-md border border-violet-300 bg-violet-50 p-3 text-sm text-violet-950"><p className="font-semibold">Pending tier change</p><p>{state.pendingTierChange.subscriptionTier} at <SavedZoneTime value={state.pendingTierChange.effectiveCycleStart} />; expected revision {state.pendingTierChange.expectedTierRevision}; operation <span className="break-all font-mono">{state.pendingTierChange.operationId}</span>.</p></div>}
      <h3 className="mt-6 font-semibold text-gray-950">Authoritative grant history</h3>
      {state.grantHistory.items.length === 0 ? <p className="mt-2 text-sm text-gray-600">No grant evidence is present in the loaded history.</p> : <ul className="mt-3 space-y-3">{state.grantHistory.items.map((grant) => <li key={grant.grantId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><dl className="grid min-w-0 gap-2 sm:grid-cols-2"><div><dt className="font-medium text-gray-600">Grant ID</dt><dd className="break-all font-mono">{grant.grantId}</dd></div><div><dt className="font-medium text-gray-600">Grant operation ID</dt><dd className="break-all font-mono">{grant.grantOperationId}</dd></div><div><dt className="font-medium text-gray-600">Ledger entry ID</dt><dd className="break-all font-mono">{grant.ledgerEntryId}</dd></div><div><dt className="font-medium text-gray-600">Credit amount</dt><dd className="break-all font-mono">{grant.creditAmount}</dd></div><div><dt className="font-medium text-gray-600">Plan snapshot</dt><dd className="break-words">{grant.planNameSnapshot}</dd></div><div><dt className="font-medium text-gray-600">Tier snapshot</dt><dd>{grant.subscriptionTierSnapshot} at revision <span className="font-mono">{grant.tierRevisionSnapshot}</span></dd></div><div><dt className="font-medium text-gray-600">Created at</dt><dd className="break-all"><SavedZoneTime value={grant.createdAt} /></dd></div></dl></li>)}</ul>}
      {hasNextPage && <button type="button" onClick={() => { void onLoadMore().catch(() => undefined) }} disabled={isLoadingMore} className="mt-4 min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{isLoadingMore ? 'Loading grant history…' : 'Load more grant history'}</button>}
      {Boolean(continuationError) && <p role="alert" className="state-indicator mt-3 text-sm text-red-800">More grant history could not be validated. Previously validated evidence remains visible.</p>}
      {state.subscriptionHistory.length > 0 && <><h3 className="mt-6 font-semibold text-gray-950">Terminal subscription history</h3><ul className="mt-3 space-y-2">{state.subscriptionHistory.map((item) => <li key={item.subscriptionId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><span className="font-medium">{item.planName}</span> · {item.status} · tier {item.subscriptionTier} revision <span className="font-mono">{item.tierRevision}</span> · valid <SavedZoneTime value={item.validFrom} /> to {item.validTo ? <SavedZoneTime value={item.validTo} /> : "open end"} · <span className="break-all font-mono">{item.subscriptionId}</span></li>)}</ul></>}
    </section>
  )
}

function TerminalHistory({ state, hasNextPage, isLoadingMore, continuationError, onLoadMore }: {
  state: BillingSubscriptionState
  hasNextPage: boolean
  isLoadingMore: boolean
  continuationError?: unknown
  onLoadMore: () => Promise<void>
}) {
  if (state.subscriptionHistory.length === 0 && state.grantHistory.items.length === 0) return null
  return (
    <section aria-labelledby="terminal-history-heading" className="mt-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
      <h2 id="terminal-history-heading" className="text-lg font-semibold text-gray-950">Read-only subscription history</h2>
      <p role="status" className="state-indicator mt-2 text-sm text-gray-700">Terminal history is evidence only and does not represent a current subscription.</p>
      {state.subscriptionHistory.length > 0 && <ul className="mt-3 space-y-2">{state.subscriptionHistory.map((item) => <li key={item.subscriptionId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><span className="font-medium">{item.planName}</span> · {item.status} · tier {item.subscriptionTier} revision <span className="font-mono">{item.tierRevision}</span> · valid <SavedZoneTime value={item.validFrom} /> to {item.validTo ? <SavedZoneTime value={item.validTo} /> : "open end"} · <span className="break-all font-mono">{item.subscriptionId}</span></li>)}</ul>}
      {state.grantHistory.items.length > 0 && <><p className="mt-3 text-sm text-gray-700">{state.grantHistory.items.length} validated historical grant {state.grantHistory.items.length === 1 ? 'record is' : 'records are'} loaded.</p><ul className="mt-2 space-y-2">{state.grantHistory.items.map((grant) => <li key={grant.grantId} className="rounded-md border border-gray-200 p-3 text-sm"><span className="font-medium">{grant.planNameSnapshot}</span> · tier {grant.subscriptionTierSnapshot} revision <span className="font-mono">{grant.tierRevisionSnapshot}</span> · <span className="break-all font-mono">{grant.grantId}</span></li>)}</ul></>}
      {hasNextPage && <button type="button" onClick={() => { void onLoadMore().catch(() => undefined) }} disabled={isLoadingMore} className="mt-4 min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800">{isLoadingMore ? 'Loading grant history…' : 'Load more grant history'}</button>}
      {Boolean(continuationError) && <p role="alert" className="mt-3 text-sm text-red-800">More grant history could not be validated.</p>}
    </section>
  )
}

type DurableSubscriptionError = {
  source: 'subscription' | 'account' | 'permission'
  error: Error | ApiError
}

function CanonicalSubscriptionPage({ clientId, canCreate, onDurableError }: {
  clientId: string
  canCreate: boolean
  onDurableError: (error: DurableSubscriptionError) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const queryClient = useQueryClient()
  const { hasPermission } = useAuth()
  const canViewAccount = hasPermission('billing:view')
  const subscriptionQuery = useBillingSubscriptions(clientId)
  const accountQuery = useBillingAccount(canViewAccount ? clientId : null)
  const capabilityQuery = useClientCapabilities(clientId)
  const consequenceQuery = useResourceAccessConsequences(clientId)
  const lifecycle = useSubscriptionLifecycle(clientId, {
    onPermissionDenied: (error) => onDurableError({ source: 'subscription', error }),
  })
  const [localReceipt, setLocalReceipt] = useState<LocalSubscriptionReceipt | null>(null)
  const [tierAuthorityPending, setTierAuthorityPending] = useState(false)

  useEffect(() => {
    const clearDraft = () => setLocalReceipt(null)
    window.addEventListener('auth:cleared', clearDraft)
    window.addEventListener('auth:refreshed', clearDraft)
    return () => {
      window.removeEventListener('auth:cleared', clearDraft)
      window.removeEventListener('auth:refreshed', clearDraft)
    }
  }, [])

  const preconfirm = useCallback(async () => {
    const [subscriptionResult, accountResult] = await Promise.all([
      subscriptionQuery.refetch(),
      canViewAccount ? accountQuery.refetch() : Promise.resolve(null),
    ])
    return !subscriptionResult.error && !subscriptionResult.data?.current &&
      (!canViewAccount || Boolean(accountResult && !accountResult.error && accountResult.data?.status === 'active'))
  }, [accountQuery, canViewAccount, subscriptionQuery])

  const lifecyclePreflight = useCallback(async () => {
    const result = await subscriptionQuery.refetch()
    return result.error || !result.data ? null : result.data
  }, [subscriptionQuery])

  const tierPreflight = useCallback(async () => {
    const subscriptionResult = await subscriptionQuery.refetch()
    if (subscriptionResult.error && [401, 403, 404].includes(
      errorStatus(subscriptionResult.error) ?? 0
    )) throw subscriptionResult.error
    return subscriptionResult.error || !subscriptionResult.data ? null : subscriptionResult.data
  }, [subscriptionQuery])

  useEffect(() => { headingRef.current?.focus() }, [clientId])
  useLayoutEffect(() => { setTierAuthorityPending(false) }, [clientId])
  useEffect(() => { setLocalReceipt(null) }, [clientId])

  useEffect(() => {
    if (subscriptionQuery.error && (
      subscriptionQuery.error instanceof BillingSubscriptionContractError ||
      [401, 403].includes(errorStatus(subscriptionQuery.error) ?? 0)
    )) {
      queueMicrotask(() => { void clearPrivateClientScope(queryClient) })
      onDurableError({ source: 'subscription', error: subscriptionQuery.error })
    }
  }, [onDurableError, queryClient, subscriptionQuery.error])

  useEffect(() => {
    if (capabilityQuery.error && (
      capabilityQuery.error instanceof ClientCapabilitiesContractError ||
      [401, 403].includes(errorStatus(capabilityQuery.error) ?? 0)
    )) {
      onDurableError({ source: 'subscription', error: capabilityQuery.error })
      queueMicrotask(() => { void clearPrivateClientScope(queryClient) })
    }
  }, [capabilityQuery.error, clientId, onDurableError, queryClient])

  useEffect(() => {
    if (accountQuery.error && (
      accountQuery.error instanceof BillingContractError ||
      [401, 403, 404].includes(errorStatus(accountQuery.error) ?? 0)
    )) {
      onDurableError({ source: 'account', error: accountQuery.error })
    }
  }, [accountQuery.error, onDurableError])

  useEffect(() => {
    const error = subscriptionQuery.continuationError
    if (error && [401, 403].includes(errorStatus(error) ?? 0)) {
      onDurableError({ source: 'subscription', error: error as ApiError })
    }
  }, [onDurableError, subscriptionQuery.continuationError])

  const subscriptionError = subscriptionQuery.error
  const accountError = accountQuery.error
  const subscriptionStatus = errorStatus(subscriptionError)
  const accountStatus = errorStatus(accountError)
  const subscription = subscriptionQuery.data
  const account = accountQuery.data

  if (subscriptionError && (subscriptionStatus === 401 || subscriptionStatus === 403 ||
      subscriptionStatus === 404 || subscriptionError instanceof BillingSubscriptionContractError)) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><LoadingSpinner message="Securing private subscription state…" /></SubscriptionFrame>
  }

  if (subscriptionQuery.isPending && !subscription && !subscriptionError) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><LoadingSpinner message="Loading subscription state…" /></SubscriptionFrame>
  }
  if ((subscriptionQuery.isError || Boolean(subscriptionError)) && !subscription) {
    if (subscriptionStatus === 401 || subscriptionStatus === 403 ||
        subscriptionError instanceof BillingSubscriptionContractError) {
      return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><LoadingSpinner message="Securing private subscription state…" /></SubscriptionFrame>
    }
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><ErrorDisplay message="Subscription state unavailable" detail="The current subscription state could not be loaded. No state has been inferred." onRetry={() => void subscriptionQuery.refetch()} /></SubscriptionFrame>
  }

  if (subscription?.current) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><div className="space-y-4">{localReceipt && <LocalSubscriptionCreatedNotice receipt={localReceipt} />}{!tierAuthorityPending && <CapabilityPolicyContext clientId={clientId} capabilities={capabilityQuery.data} isLoading={capabilityQuery.isPending} isFetching={capabilityQuery.isFetching} error={capabilityQuery.error} onRetry={() => void capabilityQuery.refetch()} />}<SubscriptionTierControls clientId={clientId} state={subscription} preflight={tierPreflight} onPermissionDenied={(error) => onDurableError({ source: 'subscription', error })} onAuthorityPending={setTierAuthorityPending} />{tierAuthorityPending && <p role="status" className="state-indicator rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">Current subscription and consequence details are hidden until authoritative reconciliation completes.</p>}{!tierAuthorityPending && <SubscriptionLifecycleControlsView clientId={clientId} state={subscription} preflight={lifecyclePreflight} lifecycle={lifecycle} />}{subscriptionError && <p role="alert" className="state-indicator rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Refresh failed. This is the last validated subscription state for this Client and may be stale.</p>}{!tierAuthorityPending && <CurrentSubscription subscription={subscription.current} state={subscription} hasNextPage={subscriptionQuery.hasNextPage} isLoadingMore={subscriptionQuery.isLoadingMore} continuationError={subscriptionQuery.continuationError} onLoadMore={subscriptionQuery.loadMore} />}{!tierAuthorityPending && <ResourceAccessConsequenceTimeline consequences={consequenceQuery.data} isLoading={consequenceQuery.isPending} error={consequenceQuery.error} onRetry={() => void consequenceQuery.refetch()} />}</div></SubscriptionFrame>
  }
  if (lifecycle.receipt && subscription) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><div className="space-y-4"><CapabilityPolicyContext clientId={clientId} capabilities={capabilityQuery.data} isLoading={capabilityQuery.isPending} isFetching={capabilityQuery.isFetching} error={capabilityQuery.error} onRetry={() => void capabilityQuery.refetch()} /><SubscriptionLifecycleControlsView clientId={clientId} state={subscription} preflight={lifecyclePreflight} lifecycle={lifecycle} /><TerminalHistory state={subscription} hasNextPage={subscriptionQuery.hasNextPage} isLoadingMore={subscriptionQuery.isLoadingMore} continuationError={subscriptionQuery.continuationError} onLoadMore={subscriptionQuery.loadMore} /></div></SubscriptionFrame>
  }
  if (subscriptionError) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><ErrorDisplay message="Fresh subscription state unavailable" detail="Creation remains disabled until a fresh subscription precheck succeeds." onRetry={() => void subscriptionQuery.refetch()} /></SubscriptionFrame>
  }

  if (canViewAccount && accountQuery.isPending && !account && !accountError) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><LoadingSpinner message="Checking credit account readiness…" /></SubscriptionFrame>
  }
  if (canViewAccount && (accountQuery.isError || Boolean(accountError))) {
    if (accountStatus === 401 || accountStatus === 403 || accountStatus === 404 ||
        accountError instanceof BillingContractError) {
      return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><LoadingSpinner message="Securing private account state…" /></SubscriptionFrame>
    }
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><ErrorDisplay message="Credit account readiness unavailable" detail="Creation remains disabled until a fresh account check succeeds." onRetry={() => void accountQuery.refetch()} /></SubscriptionFrame>
  }
  if (account && account.status !== 'active') {
    return (
      <SubscriptionFrame clientId={clientId} headingRef={headingRef}>
        <EmptyState title="Subscription creation unavailable" description={`The CreditAccount is ${account.status}. Its status must be active before subscription creation.`} />
      </SubscriptionFrame>
    )
  }
  if (!canCreate) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><Forbidden message="Subscription creation controls are unavailable for the current mapped role." /></SubscriptionFrame>
  }

  return (
    <SubscriptionFrame clientId={clientId} headingRef={headingRef}>
      <div className="space-y-4">
        <CapabilityPolicyContext clientId={clientId} capabilities={capabilityQuery.data} isLoading={capabilityQuery.isPending} isFetching={capabilityQuery.isFetching} error={capabilityQuery.error} onRetry={() => void capabilityQuery.refetch()} />
        {subscription && <SubscriptionLifecycleControlsView clientId={clientId} state={subscription} preflight={lifecyclePreflight} lifecycle={lifecycle} />}
        {!canViewAccount && (
          <p role="status" className="state-indicator rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Credit account readiness cannot be checked with your current permission. The server will verify it when you submit.
          </p>
        )}
        <LocalSubscriptionCreationWorkspace
          clientId={clientId}
          onPreconfirm={preconfirm}
          onCreated={setLocalReceipt}
        />
      </div>
      {subscription && <TerminalHistory state={subscription} hasNextPage={subscriptionQuery.hasNextPage} isLoadingMore={subscriptionQuery.isLoadingMore} continuationError={subscriptionQuery.continuationError} onLoadMore={subscriptionQuery.loadMore} />}
    </SubscriptionFrame>
  )
}

function PermissionAwareSubscriptionPage({ clientId }: { clientId: string }) {
  const { hasPermission } = useAuth()
  const allowed = hasPermission('billing:subscription')
  const previouslyAllowed = useRef(allowed)
  const [durableState, setDurableState] = useState<{
    clientId: string
    value: DurableSubscriptionError
  } | null>(null)
  const queryClient = useQueryClient()
  const handleDurableError = useCallback((value: DurableSubscriptionError) => {
    setDurableState({ clientId, value })
  }, [clientId])

  useLayoutEffect(() => {
    if (previouslyAllowed.current && !allowed) {
      setDurableState({
        clientId,
        value: {
          source: 'permission',
          error: { code: 'LOCAL_PERMISSION_LOST', message: 'Permission removed', status: 403 },
        },
      })
      queueMicrotask(() => { void clearPrivateClientScope(queryClient) })
    }
    previouslyAllowed.current = allowed
  }, [allowed, clientId, queryClient])

  const durable = durableState?.clientId === clientId ? durableState.value : null
  if (durable) {
    const status = errorStatus(durable.error)
    let content: React.ReactNode
    if (durable.source === 'permission') {
      content = <Forbidden message="Subscription permission is no longer available. Private subscription data was removed." />
    } else if (durable.source === 'subscription' && status === 403) {
      content = <Forbidden message="The server denied subscription access for this Client." />
    } else if (durable.source === 'subscription' && status === 401) {
      content = <ErrorDisplay message="Session ended" detail="Sign in again to request this private subscription state." />
    } else if (durable.source === 'subscription') {
      content = <ErrorDisplay message="Subscription state unavailable" detail="The server response did not match the Billing subscription contract. No subscription values have been displayed." />
    } else if (status === 404) {
      content = <><EmptyState title="Credit account not configured" description="Open Account to configure this Client before creating a subscription. No account or zero balance has been inferred." /><Link to={`/billing/clients/${clientId}/account`} className="mx-auto flex min-h-11 w-fit items-center font-semibold text-indigo-700 underline">Open Account</Link></>
    } else if (status === 403) {
      content = <Forbidden message="The server denied access to the CreditAccount readiness check." />
    } else if (status === 401) {
      content = <ErrorDisplay message="Session ended" detail="Sign in again before creating a subscription." />
    } else {
      content = <ErrorDisplay message="Credit account readiness unavailable" detail="The server response did not match the Billing account contract. Creation remains disabled." />
    }
    return <SubscriptionFrame clientId={clientId}>{content}</SubscriptionFrame>
  }
  return <CanonicalSubscriptionPage
    key={clientId}
    clientId={clientId}
    canCreate={allowed}
    onDurableError={handleDurableError}
  />
}

export function BillingSubscriptionPage() {
  const { clientId: routeClientId } = useParams()
  const clientId = canonicalizeGuid(routeClientId)
  if (!clientId) return <EmptyState title="Client context unavailable" description="A valid Client URL is required for the Billing workspace." />
  if (routeClientId !== clientId) {
    return <Navigate to={`/billing/clients/${clientId}/subscriptions`} replace />
  }
  return <PermissionAwareSubscriptionPage clientId={clientId} />
}
