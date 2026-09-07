import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../../api/apiClient'
import { BillingContractError, BillingSubscriptionContractError } from '../../api/billingApi'
import { BillingWorkspaceNav } from '../../components/billing/BillingWorkspaceNav'
import { EMPTY_SUBSCRIPTION_DRAFT, SubscriptionCreationForm, type SubscriptionDraft } from '../../components/billing/SubscriptionCreationForm'
import { SubscriptionReview } from '../../components/billing/SubscriptionReview'
import { Breadcrumbs, EmptyState, ErrorDisplay, Forbidden, LoadingSpinner } from '../../components/shared'
import { useAuth } from '../../hooks/useAuth'
import { useSubscriptionCreation } from '../../hooks/useSubscriptionCreation'
import { canonicalizeGuid } from '../../lib/guid'
import {
  clearPrivateBillingQueries,
  useBillingAccount,
  useBillingSubscriptions,
} from '../../queries/billingQueries'
import type { BillingSubscriptionItem, BillingSubscriptionState } from '../../types/billing'

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as ApiError).status
    : undefined
}

function equivalentDecimal(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return normalize(left) === normalize(right)
}

function reconcilesAttempt(
  item: BillingSubscriptionItem,
  request: NonNullable<ReturnType<typeof useSubscriptionCreation>['attempt']>['request']
): boolean {
  return item.planName === request.planName &&
    equivalentDecimal(item.cycleCreditAmount, request.cycleCreditAmount) &&
    Date.parse(item.validFrom) === Date.parse(request.validFrom) &&
    (item.validTo === null || request.validTo === null
      ? item.validTo === request.validTo
      : Date.parse(item.validTo) === Date.parse(request.validTo)) &&
    item.changeEffectivePolicy === request.changeEffectivePolicy &&
    item.prorationPolicy === request.prorationPolicy &&
    item.unusedCreditPolicy === request.unusedCreditPolicy &&
    item.entitlements.schemaVersion === request.entitlements.schemaVersion &&
    item.entitlements.rateLimits.requestsPerMinute === request.entitlements.rateLimits.requestsPerMinute &&
    item.entitlements.rateLimits.concurrentAiOperations === request.entitlements.rateLimits.concurrentAiOperations &&
    item.entitlements.featureFlags.contentGeneration === request.entitlements.featureFlags.contentGeneration &&
    item.entitlements.featureFlags.imageGeneration === request.entitlements.featureFlags.imageGeneration
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
        <div><dt className="text-sm font-medium text-gray-600">Cycle credits</dt><dd className="break-all text-gray-950">{subscription.cycleCreditAmount}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Valid from</dt><dd className="break-all text-gray-950"><time dateTime={subscription.validFrom}>{subscription.validFrom}</time></dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Valid to</dt><dd className="break-all text-gray-950">{subscription.validTo ?? 'No end date'}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Change timing</dt><dd className="text-gray-950">{subscription.changeEffectivePolicy}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Proration</dt><dd className="text-gray-950">{subscription.prorationPolicy}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Unused credits</dt><dd className="text-gray-950">Rollover</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Requests per minute</dt><dd className="text-gray-950">{subscription.entitlements.rateLimits.requestsPerMinute}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Concurrent AI operations</dt><dd className="text-gray-950">{subscription.entitlements.rateLimits.concurrentAiOperations}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Content generation</dt><dd className="text-gray-950">{subscription.entitlements.featureFlags.contentGeneration ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt className="text-sm font-medium text-gray-600">Image generation</dt><dd className="text-gray-950">{subscription.entitlements.featureFlags.imageGeneration ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      <p className="mt-4 text-sm text-gray-600">Monthly credits renew by UTC calendar month from the subscription start.</p>
      {(subscription.pendingImmediateDebit || subscription.immediateChangeContext || state.pendingChange ||
        state.pendingImmediateDebit || state.immediateChangeContext) && (
        <p role="status" className="state-indicator mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Additional subscription change context is present and is read-only on this page.
        </p>
      )}
      <h3 className="mt-6 font-semibold text-gray-950">Authoritative grant history</h3>
      {state.grantHistory.items.length === 0 ? <p className="mt-2 text-sm text-gray-600">No grant evidence is present in the loaded history.</p> : <ul className="mt-3 space-y-3">{state.grantHistory.items.map((grant) => <li key={grant.grantId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><dl className="grid min-w-0 gap-2 sm:grid-cols-2"><div><dt className="font-medium text-gray-600">Grant ID</dt><dd className="break-all font-mono">{grant.grantId}</dd></div><div><dt className="font-medium text-gray-600">Grant operation ID</dt><dd className="break-all font-mono">{grant.grantOperationId}</dd></div><div><dt className="font-medium text-gray-600">Ledger entry ID</dt><dd className="break-all font-mono">{grant.ledgerEntryId}</dd></div><div><dt className="font-medium text-gray-600">Credit amount</dt><dd className="break-all font-mono">{grant.creditAmount}</dd></div><div><dt className="font-medium text-gray-600">Plan snapshot</dt><dd className="break-words">{grant.planNameSnapshot}</dd></div><div><dt className="font-medium text-gray-600">Created at</dt><dd className="break-all">{grant.createdAt}</dd></div></dl></li>)}</ul>}
      {hasNextPage && <button type="button" onClick={() => { void onLoadMore().catch(() => undefined) }} disabled={isLoadingMore} className="mt-4 min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{isLoadingMore ? 'Loading grant history…' : 'Load more grant history'}</button>}
      {Boolean(continuationError) && <p role="alert" className="state-indicator mt-3 text-sm text-red-800">More grant history could not be validated. Previously validated evidence remains visible.</p>}
      {state.subscriptionHistory.length > 0 && <><h3 className="mt-6 font-semibold text-gray-950">Terminal subscription history</h3><ul className="mt-3 space-y-2">{state.subscriptionHistory.map((item) => <li key={item.subscriptionId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><span className="font-medium">{item.planName}</span> · {item.status} · <span className="break-all font-mono">{item.subscriptionId}</span></li>)}</ul></>}
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
  return <section aria-labelledby="terminal-history-heading" className="mt-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-6"><h2 id="terminal-history-heading" className="text-lg font-semibold text-gray-950">Read-only subscription history</h2><p role="status" className="state-indicator mt-2 text-sm text-gray-700">Terminal history is evidence only and does not represent a current subscription.</p>{state.subscriptionHistory.length > 0 && <ul className="mt-3 space-y-2">{state.subscriptionHistory.map((item) => <li key={item.subscriptionId} className="min-w-0 rounded-md border border-gray-200 p-3 text-sm"><span className="font-medium">{item.planName}</span> · {item.status} · <span className="break-all font-mono">{item.subscriptionId}</span></li>)}</ul>}{state.grantHistory.items.length > 0 && <p className="mt-3 text-sm text-gray-700">{state.grantHistory.items.length} validated historical grant {state.grantHistory.items.length === 1 ? 'record is' : 'records are'} loaded.</p>}{hasNextPage && <button type="button" onClick={() => { void onLoadMore().catch(() => undefined) }} disabled={isLoadingMore} className="mt-4 min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800">{isLoadingMore ? 'Loading grant history…' : 'Load more grant history'}</button>}{Boolean(continuationError) && <p role="alert" className="mt-3 text-sm text-red-800">More grant history could not be validated.</p>}</section>
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
  const { hasPermission } = useAuth()
  const canViewAccount = hasPermission('billing:view')
  const subscriptionQuery = useBillingSubscriptions(clientId)
  const accountQuery = useBillingAccount(canViewAccount ? clientId : null)
  const creation = useSubscriptionCreation(clientId, {
    onPermissionDenied: (error) => onDurableError({ source: 'subscription', error }),
  })
  const [draft, setDraft] = useState<SubscriptionDraft>(EMPTY_SUBSCRIPTION_DRAFT)
  const [reconciliation, setReconciliation] = useState<'idle' | 'checking' | 'matched' | 'absent' | 'unavailable' | 'mismatch'>('idle')
  const reconciliationErrorRef = useRef<unknown>(null)

  useEffect(() => {
    const clearDraft = () => setDraft(EMPTY_SUBSCRIPTION_DRAFT)
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

  useEffect(() => { headingRef.current?.focus() }, [clientId])

  useEffect(() => {
    if (subscriptionQuery.error && (
      subscriptionQuery.error instanceof BillingSubscriptionContractError ||
      [401, 403].includes(errorStatus(subscriptionQuery.error) ?? 0)
    )) {
      onDurableError({ source: 'subscription', error: subscriptionQuery.error })
    }
  }, [onDurableError, subscriptionQuery.error])

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

  useEffect(() => {
    if (!creation.error || reconciliationErrorRef.current === creation.error ||
        (creation.outcome !== 'unknown' && creation.outcome !== 'rejected')) return
    reconciliationErrorRef.current = creation.error
    if (creation.outcome !== 'unknown') {
      void subscriptionQuery.refetch()
      if (canViewAccount) void accountQuery.refetch()
      return
    }
    setReconciliation('checking')
    void Promise.all([
      subscriptionQuery.refetch(),
      canViewAccount ? accountQuery.refetch() : Promise.resolve(null),
    ]).then(([result]) => {
      if (result.error || !creation.attempt) return setReconciliation('unavailable')
      const matching = [result.data?.current, ...(result.data?.subscriptionHistory ?? [])]
        .find((item) => item?.creationOperationId === creation.attempt?.request.creationOperationId)
      if (!matching) return setReconciliation('absent')
      const request = creation.attempt.request
      setReconciliation(reconcilesAttempt(matching, request) ? 'matched' : 'mismatch')
    }).catch(() => setReconciliation('unavailable'))
  }, [accountQuery, canViewAccount, creation.error, creation.outcome, subscriptionQuery])

  const subscriptionError = subscriptionQuery.error
  const accountError = accountQuery.error
  const subscriptionStatus = errorStatus(subscriptionError)
  const accountStatus = errorStatus(accountError)
  const subscription = subscriptionQuery.data
  const account = accountQuery.data

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

  if (creation.receipt) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><SubscriptionReview
      receipt={creation.receipt}
      state={subscription}
      currentAccount={canViewAccount ? account : null}
      hasNextPage={subscriptionQuery.hasNextPage}
      isLoadingMore={subscriptionQuery.isLoadingMore}
      continuationError={subscriptionQuery.continuationError}
      stateRefreshError={subscriptionError}
      accountRefreshError={accountError}
      stateRefreshing={subscriptionQuery.isFetching}
      accountRefreshing={accountQuery.isFetching}
      onLoadMore={subscriptionQuery.loadMore}
    /></SubscriptionFrame>
  }

  if (subscription?.current) {
    return <SubscriptionFrame clientId={clientId} headingRef={headingRef}><div className="space-y-4">{subscriptionError && <p role="alert" className="state-indicator rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Refresh failed. This is the last validated subscription state for this Client and may be stale.</p>}<CreationOutcomePanel creation={creation} canViewAccount={canViewAccount} clientId={clientId} state={subscription} reconciliation={reconciliation} /><CurrentSubscription subscription={subscription.current} state={subscription} hasNextPage={subscriptionQuery.hasNextPage} isLoadingMore={subscriptionQuery.isLoadingMore} continuationError={subscriptionQuery.continuationError} onLoadMore={subscriptionQuery.loadMore} /></div></SubscriptionFrame>
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
        {!canViewAccount && (
          <p role="status" className="state-indicator rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Credit account readiness cannot be checked with your current permission. The server will verify it when you submit.
          </p>
        )}
        <CreationOutcomePanel creation={creation} canViewAccount={canViewAccount} clientId={clientId} state={subscription} reconciliation={reconciliation} />
        <SubscriptionCreationForm
          clientId={clientId}
          onConfirm={creation.confirm}
          disabled={creation.outcome !== 'idle'}
          draft={draft}
          onDraftChange={setDraft}
          onPreconfirm={preconfirm}
          serverValidationError={creation.outcome === 'rejected' && errorStatus(creation.error) === 400}
        />
      </div>
      {subscription && <TerminalHistory state={subscription} hasNextPage={subscriptionQuery.hasNextPage} isLoadingMore={subscriptionQuery.isLoadingMore} continuationError={subscriptionQuery.continuationError} onLoadMore={subscriptionQuery.loadMore} />}
    </SubscriptionFrame>
  )
}

function CreationOutcomePanel({ creation, canViewAccount, clientId, reconciliation }: {
  creation: ReturnType<typeof useSubscriptionCreation>
  canViewAccount: boolean
  clientId: string
  state?: BillingSubscriptionState
  reconciliation: 'idle' | 'checking' | 'matched' | 'absent' | 'unavailable' | 'mismatch'
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (creation.outcome !== 'idle') headingRef.current?.focus()
  }, [creation.outcome])
  if (creation.outcome === 'idle' || creation.receipt) return null
  if (creation.outcome === 'submitting') {
    return <section aria-labelledby="creation-progress-heading" className="rounded-md border border-indigo-300 bg-indigo-50 p-4"><h2 id="creation-progress-heading" ref={headingRef} tabIndex={-1} className="font-semibold text-indigo-950 outline-none">Creating subscription</h2><p role="status" className="state-indicator mt-1 text-sm text-indigo-950">Submitting the retained operation once…</p></section>
  }

  const error = creation.error as ApiError | null
  const status = errorStatus(error)
  const code = error?.code
  if (creation.outcome === 'unknown') {
    const guidance = reconciliation === 'checking' ? 'Checking authoritative subscription evidence before retry is allowed…'
      : reconciliation === 'matched' ? 'Matching authoritative subscription evidence was found. The operation is recovered; no retry is needed.'
        : reconciliation === 'absent' ? 'No matching evidence was found in the authoritative state. Only the exact retained operation may be retried.'
          : reconciliation === 'mismatch' ? 'Authoritative evidence conflicts with the retained material. The outcome remains unresolved and retry is blocked.'
            : 'Authoritative reconciliation is unavailable. The outcome remains unresolved and retry is blocked.'
    return <section aria-labelledby="creation-unknown-heading" className="rounded-md border border-amber-300 bg-amber-50 p-4"><h2 id="creation-unknown-heading" ref={headingRef} tabIndex={-1} className="font-semibold text-amber-950 outline-none">Outcome unknown</h2><p role="alert" className="state-indicator mt-1 text-sm text-amber-950">The subscription may have been created. The exact operation identity and byte-equivalent body are retained; no replacement identity will be generated.</p><p className="mt-2 text-sm text-amber-950">{guidance}</p><div className="mt-3 flex flex-wrap gap-3">{reconciliation === 'absent' && <button type="button" onClick={() => void creation.retry()} className="min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Retry exact operation</button>}<button type="button" onClick={creation.abandon} className="min-h-11 rounded-md border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Abandon unresolved attempt</button></div><p className="mt-2 text-xs text-amber-900">Abandon only if you accept that the earlier request may still have committed; returning later will refresh authoritative state.</p></section>
  }

  let title = 'Subscription creation rejected'
  let detail = 'The server rejected this logical operation. Your entered values and operation identity remain unchanged.'
  let allowNew = true
  if (status === 400) {
    title = 'Invalid subscription creation request'
    detail = 'The server rejected the request as invalid without assigning errors to individual fields.'
  } else if (status === 404) {
    title = 'Billing not configured'
    detail = 'Billing or its CreditAccount is not configured for this Client. Nothing has been provisioned automatically.'
  } else if (status === 409 && code === 'subscription_operation_conflict') {
    title = 'Operation identity conflict'
    detail = 'This creation operation identity is already bound to different material. It cannot be retried with changed values.'
    allowNew = false
  } else if (status === 409 && code === 'subscription_current_conflict') {
    title = 'Current subscription conflict'
    detail = 'Another current subscription exists. The authoritative state has been refreshed and will not be overwritten.'
    allowNew = false
  } else if (status === 409 && code === 'credit_account_inactive') {
    title = 'Credit account inactive'
    detail = 'The CreditAccount is not active. Its status has not been changed.'
  } else if (status === 409 && code === 'credit_balance_overflow') {
    title = 'Credit balance capacity conflict'
    detail = 'The exact requested amount would exceed account capacity. It has not been rounded or reduced.'
  } else if (status === 413 || status === 415) {
    title = 'Subscription request contract failure'
    detail = status === 413
      ? 'The server rejected this closed request as too large.'
      : 'The server rejected the required JSON media type.'
  }
  return <section aria-labelledby="creation-rejected-heading" className="rounded-md border border-red-300 bg-red-50 p-4"><h2 id="creation-rejected-heading" ref={headingRef} tabIndex={-1} className="font-semibold text-red-950 outline-none">{title}</h2><p role="alert" className="state-indicator mt-1 text-sm text-red-950">{detail}</p>{status === 404 && canViewAccount && <a href={`/billing/clients/${clientId}/account`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-indigo-700 underline">Open Account</a>}{allowNew && <div className="mt-3"><button type="button" onClick={creation.abandon} className="min-h-11 rounded-md border border-red-400 bg-white px-4 py-2 text-sm font-semibold text-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Start a new logical submission</button></div>}</section>
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
      void clearPrivateBillingQueries(queryClient)
      setDurableState({
        clientId,
        value: {
          source: 'permission',
          error: { code: 'LOCAL_PERMISSION_LOST', message: 'Permission removed', status: 403 },
        },
      })
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
