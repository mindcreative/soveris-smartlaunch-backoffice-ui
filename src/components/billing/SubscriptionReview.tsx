import { useEffect, useRef } from 'react'
import type {
  BillingAccountSnapshot,
  BillingEntitlementsV1,
  BillingSubscriptionCreationReceipt,
  BillingSubscriptionState,
} from '../../types/billing'
import { LocalInstant } from '../../timezone/LocalInstant'

export interface ReceiptMatch {
  subscription: boolean
  grant: boolean
  mismatch: boolean
}

function decimalsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return normalize(left) === normalize(right)
}

function entitlementsEqual(left: BillingEntitlementsV1, right: BillingEntitlementsV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function matchSubscriptionReceipt(
  receipt: BillingSubscriptionCreationReceipt,
  state: BillingSubscriptionState | undefined
): ReceiptMatch {
  if (!state) return { subscription: false, grant: false, mismatch: false }
  const subscriptions = [state.current, ...state.subscriptionHistory].filter((item) => item !== null)
  const subscription = subscriptions.find((item) =>
    item.creationOperationId === receipt.subscription.creationOperationId ||
    item.subscriptionId === receipt.subscription.subscriptionId)
  const subscriptionMatches = Boolean(subscription &&
    subscription.subscriptionId === receipt.subscription.subscriptionId &&
    subscription.creationOperationId === receipt.subscription.creationOperationId &&
    subscription.planTermsOperationId === receipt.subscription.planTermsOperationId &&
    subscription.planName === receipt.subscription.planName &&
    subscription.subscriptionTier === receipt.subscription.subscriptionTier &&
    subscription.tierRevision === receipt.subscription.tierRevision &&
    decimalsEqual(subscription.cycleCreditAmount, receipt.subscription.cycleCreditAmount) &&
    entitlementsEqual(subscription.entitlements, receipt.subscription.entitlements) &&
    subscription.changeEffectivePolicy === receipt.subscription.changeEffectivePolicy &&
    subscription.prorationPolicy === receipt.subscription.prorationPolicy &&
    subscription.unusedCreditPolicy === receipt.subscription.unusedCreditPolicy &&
    subscription.validFrom === receipt.subscription.validFrom &&
    (subscription.validTo === null || receipt.subscription.validTo === null
      ? subscription.validTo === receipt.subscription.validTo
      : subscription.validTo === receipt.subscription.validTo))
  const subscriptionMismatch = Boolean(subscription && !subscriptionMatches)

  const grant = state.grantHistory.items.find((item) =>
    item.grantId === receipt.initialGrant.grantId ||
    item.grantOperationId === receipt.initialGrant.grantOperationId ||
    item.ledgerEntryId === receipt.initialGrant.ledgerEntryId)
  const grantMatches = Boolean(grant &&
    grant.grantId === receipt.initialGrant.grantId &&
    grant.grantOperationId === receipt.initialGrant.grantOperationId &&
    grant.ledgerEntryId === receipt.initialGrant.ledgerEntryId &&
    grant.subscriptionId === receipt.subscription.subscriptionId &&
    grant.planTermsOperationId === receipt.initialGrant.planTermsOperationId &&
    grant.planNameSnapshot === receipt.initialGrant.planNameSnapshot &&
    grant.subscriptionTierSnapshot === receipt.initialGrant.subscriptionTierSnapshot &&
    grant.tierRevisionSnapshot === receipt.initialGrant.tierRevisionSnapshot &&
    entitlementsEqual(grant.entitlementsSnapshot, receipt.initialGrant.entitlementsSnapshot) &&
    decimalsEqual(grant.creditAmount, receipt.initialGrant.creditAmount) &&
    grant.grantType === receipt.initialGrant.grantType &&
    grant.cycleStart === receipt.initialGrant.cycleStart &&
    grant.cycleEnd === receipt.initialGrant.cycleEnd)
  return {
    subscription: subscriptionMatches,
    grant: grantMatches,
    mismatch: subscriptionMismatch || Boolean(grant && !grantMatches),
  }
}

interface SubscriptionReviewProps {
  receipt: BillingSubscriptionCreationReceipt
  state?: BillingSubscriptionState
  currentAccount: BillingAccountSnapshot | null | undefined
  hasNextPage?: boolean
  isLoadingMore?: boolean
  continuationError?: unknown
  stateRefreshError?: unknown
  accountRefreshError?: unknown
  stateRefreshing?: boolean
  accountRefreshing?: boolean
  onLoadMore?: () => void | Promise<void>
}

export function SubscriptionReview({
  receipt, state, currentAccount, hasNextPage = false, isLoadingMore = false,
  continuationError, stateRefreshError, accountRefreshError, stateRefreshing = false,
  accountRefreshing = false, onLoadMore,
}: SubscriptionReviewProps) {
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { receiptHeadingRef.current?.focus() }, [])
  const evidence = matchSubscriptionReceipt(receipt, state)
  const outcome = receipt.created ? 'Created' : 'Already completed'
  return (
    <div className="space-y-6">
      <section aria-labelledby="creation-receipt-heading" className="rounded-lg border border-green-300 bg-green-50 p-4 sm:p-6">
        <h2 id="creation-receipt-heading" ref={receiptHeadingRef} tabIndex={-1} className="text-lg font-semibold text-green-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{outcome}</h2>
        <p role="status" className="state-indicator mt-2 text-sm text-green-950">
          {receipt.created
            ? 'The server created this subscription and returned its immutable creation receipt.'
            : 'This is the original result of the same operation. No second subscription or grant was created.'}
        </p>
        <h3 className="mt-5 font-semibold text-gray-950">Immutable subscription outcome</h3>
        <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
          <Value label="Subscription ID" value={receipt.subscription.subscriptionId} mono />
          <Value label="Creation operation ID" value={receipt.subscription.creationOperationId} mono />
          <Value label="Plan terms operation ID" value={receipt.subscription.planTermsOperationId} mono />
          <Value label="Client" value={receipt.subscription.clientId} mono />
          <Value label="Plan" value={receipt.subscription.planName} />
          <Value label="Subscription tier" value={receipt.subscription.subscriptionTier} />
          <Value label="Tier revision" value={receipt.subscription.tierRevision} mono />
          <Value label="Cycle credits" value={receipt.subscription.cycleCreditAmount} mono />
          <Value label="Status" value={receipt.subscription.status} />
          <Value label="Valid from" value={receipt.subscription.validFrom} mono />
          <Value label="Valid to" value={receipt.subscription.validTo ?? 'No end date'} mono />
          <Value label="Change timing" value="Immediate" />
          <Value label="Proration" value="Replace" />
          <Value label="Unused credits" value="Rollover" />
        </dl>
        <EntitlementDetails value={receipt.subscription.entitlements} />

        <h3 className="mt-5 font-semibold text-gray-950">Initial grant output</h3>
        <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
          <Value label="Grant ID" value={receipt.initialGrant.grantId} mono />
          <Value label="Grant operation ID" value={receipt.initialGrant.grantOperationId} mono />
          <Value label="Ledger entry ID" value={receipt.initialGrant.ledgerEntryId} mono />
          <Value label="Granted credits" value={receipt.initialGrant.creditAmount} mono />
          <Value label="Plan snapshot" value={receipt.initialGrant.planNameSnapshot} />
          <Value label="Tier snapshot" value={receipt.initialGrant.subscriptionTierSnapshot} />
          <Value label="Tier revision snapshot" value={receipt.initialGrant.tierRevisionSnapshot} mono />
          <Value label="Grant type" value="Billing cycle" />
        </dl>

        <h3 className="mt-5 font-semibold text-gray-950">Original balance outcome</h3>
        <p className="mt-1 text-sm text-gray-700">Immutable account values as of <time dateTime={receipt.account.asOf}>{receipt.account.asOf}</time>.</p>
        <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Value label="Owned balance" value={receipt.account.ownedBalance} mono />
          <Value label="Reserved balance" value={receipt.account.activelyReservedAmount} mono />
          <Value label="Available balance" value={receipt.account.availableBalance} mono />
          <Value label="Account status" value={receipt.account.status} />
        </dl>
      </section>

      <section aria-labelledby="authoritative-review-heading" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
        <h2 id="authoritative-review-heading" className="text-lg font-semibold text-gray-950">Current authoritative review</h2>
        {Boolean(stateRefreshError) && <p role="alert" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Subscription refresh failed. Any displayed state is the last validated same-Client snapshot and may be stale.</p>}
        {stateRefreshing && <p role="status" className="state-indicator mt-3 text-sm text-gray-700">Refreshing authoritative subscription and grant state…</p>}
        {!state && <p role="status" className="state-indicator mt-3 text-sm text-gray-700">Refreshing current subscription and grant state…</p>}
        {state && evidence.mismatch && <p role="alert" className="state-indicator mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">Current evidence conflicts with the immutable receipt. No match has been inferred.</p>}
        {state && !evidence.mismatch && evidence.subscription && evidence.grant && <p role="status" className="state-indicator mt-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-950">The receipt matches authoritative subscription and grant history.</p>}
        {state && !evidence.mismatch && evidence.subscription && !evidence.grant && <p role="status" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The subscription matches. The initial grant has not yet been found in the loaded authoritative history.</p>}
        {state && !evidence.mismatch && !evidence.subscription && <p role="status" className="state-indicator mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The immutable receipt is retained, but matching current subscription evidence is not available yet.</p>}
        {state?.current && <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2"><Value label="Current subscription ID" value={state.current.subscriptionId} mono /><Value label="Current plan" value={state.current.planName} /><Value label="Current subscription tier" value={state.current.subscriptionTier} /><Value label="Current tier revision" value={state.current.tierRevision} mono /><Value label="Current cycle credits" value={state.current.cycleCreditAmount} mono /><Value label="Current state as of" value={state.stateAsOf} mono /></dl>}
        {hasNextPage && onLoadMore && <div className="mt-4"><button type="button" onClick={() => { void Promise.resolve(onLoadMore()).catch(() => undefined) }} disabled={isLoadingMore} className="min-h-11 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-wait disabled:opacity-60">{isLoadingMore ? 'Loading grant history…' : 'Load more grant history'}</button></div>}
        {Boolean(continuationError) && <p role="alert" className="state-indicator mt-3 text-sm text-red-800">More grant history could not be validated. Previously validated evidence remains visible.</p>}

        <h3 className="mt-5 font-semibold text-gray-950">Current account snapshot</h3>
        {Boolean(accountRefreshError) && <p role="alert" className="state-indicator mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Account refresh failed. Any displayed account values are the last validated same-Client snapshot and may be stale.</p>}
        {accountRefreshing && <p role="status" className="state-indicator mt-2 text-sm text-gray-700">Refreshing the current account snapshot…</p>}
        {currentAccount ? <><p className="mt-1 text-sm text-gray-700">Separate current values as of <LocalInstant value={currentAccount.asOf} />.</p><dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"><Value label="Current owned balance" value={currentAccount.ownedBalance} mono /><Value label="Current reserved balance" value={currentAccount.activelyReservedAmount} mono /><Value label="Current available balance" value={currentAccount.availableBalance} mono /><Value label="Current account status" value={currentAccount.status} /></dl></> : <p className="mt-1 text-sm text-gray-700">Current account balance is unavailable with this permission or while refresh is pending.</p>}
      </section>
    </div>
  )
}

function EntitlementDetails({ value }: { value: BillingEntitlementsV1 }) {
  return <><h3 className="mt-5 font-semibold text-gray-950">Entitlement snapshot</h3><dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><Value label="Requests per minute" value={String(value.rateLimits.requestsPerMinute)} /><Value label="Concurrent AI operations" value={String(value.rateLimits.concurrentAiOperations)} /><Value label="Content generation" value={value.featureFlags.contentGeneration ? 'Enabled' : 'Disabled'} /><Value label="Image generation" value={value.featureFlags.imageGeneration ? 'Enabled' : 'Disabled'} /></dl></>
}

function Value({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-sm font-medium text-gray-600">{label}</dt><dd className={`break-all text-gray-950 ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd></div>
}
