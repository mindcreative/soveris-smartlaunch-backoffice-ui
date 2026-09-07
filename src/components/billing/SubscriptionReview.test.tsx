import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  BillingAccountSnapshot,
  BillingSubscriptionCreationReceipt,
  BillingSubscriptionState,
} from '../../types/billing'
import { matchSubscriptionReceipt, SubscriptionReview } from './SubscriptionReview'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION_ID = '22222222-2222-3333-8444-555555555555'
const OPERATION_ID = '01991f20-1234-7abc-8abc-1234567890ab'
const GRANT_ID = '33333333-3333-4333-8333-555555555555'
const GRANT_OPERATION_ID = '01991f20-2234-7abc-8abc-1234567890ab'
const LEDGER_ID = '44444444-4444-4444-8444-555555555555'
const ENTITLEMENTS = {
  schemaVersion: 1 as const,
  rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
  featureFlags: { contentGeneration: true, imageGeneration: false },
}

function receipt(created = true): BillingSubscriptionCreationReceipt {
  return {
    created,
    subscription: {
      subscriptionId: SUBSCRIPTION_ID, creationOperationId: OPERATION_ID,
      planTermsOperationId: OPERATION_ID, clientId: CLIENT_ID, planName: 'Pro',
      cycleCreditAmount: '1250.0000', entitlements: ENTITLEMENTS,
      changeEffectivePolicy: 'immediate', prorationPolicy: 'replace',
      unusedCreditPolicy: 'rollover', billingCycleAnchor: '2026-02-15T12:00:00.000000Z',
      status: 'active', validFrom: '2026-02-15T12:00:00.000000Z', validTo: null,
    },
    initialGrant: {
      grantId: GRANT_ID, grantOperationId: GRANT_OPERATION_ID, ledgerEntryId: LEDGER_ID,
      planTermsOperationId: OPERATION_ID, planNameSnapshot: 'Pro',
      entitlementsSnapshot: ENTITLEMENTS, grantType: 'billing_cycle',
      cycleStart: '2026-02-15T12:00:00.000000Z', cycleEnd: '2026-03-15T12:00:00.000000Z',
      creditAmount: '1250.0000',
    },
    account: {
      creditAccountId: '11111111-2222-3333-8444-555555555555', clientId: CLIENT_ID,
      ownedBalance: '1260.0000', activelyReservedAmount: '5.0000', availableBalance: '1255.0000',
      status: 'active', asOf: '2026-02-15T12:00:01.000000Z',
    },
  }
}

function state(): BillingSubscriptionState {
  const value = receipt()
  return {
    clientId: CLIENT_ID, stateAsOf: '2026-02-15T12:00:02.000000Z',
    current: { ...value.subscription, createdAt: value.account.asOf, updatedAt: value.account.asOf },
    pendingChange: null, subscriptionHistory: [],
    grantHistory: {
      items: [{ ...value.initialGrant, subscriptionId: SUBSCRIPTION_ID, createdAt: value.account.asOf }],
      historyAsOf: '2026-02-15T12:00:02.000000Z', nextCursor: null,
    },
  }
}

const currentAccount: BillingAccountSnapshot = {
  ...receipt().account, ownedBalance: '1240.0000', availableBalance: '1235.0000',
  activeReservationCount: 1, walletVersion: '2', asOf: '2026-02-15T12:05:00.000000Z',
}

describe('SubscriptionReview', () => {
  it('separates the immutable creation outcome from current authoritative state', () => {
    render(<SubscriptionReview receipt={receipt()} state={state()} currentAccount={currentAccount} />)
    expect(screen.getByRole('heading', { name: 'Created' })).toBeInTheDocument()
    expect(screen.getByText('Original balance outcome')).toBeInTheDocument()
    expect(screen.getByText('Current account snapshot')).toBeInTheDocument()
    expect(screen.getByText('1260.0000')).toBeInTheDocument()
    expect(screen.getByText('1240.0000')).toBeInTheDocument()
    expect(screen.getByText(GRANT_ID)).toBeInTheDocument()
    expect(screen.getByText(GRANT_OPERATION_ID)).toBeInTheDocument()
    expect(screen.getByText(LEDGER_ID)).toBeInTheDocument()
    expect(screen.getByText(/receipt matches authoritative subscription and grant history/i)).toBeInTheDocument()
    expect(screen.queryByText(/billing cycle anchor|cycle start|cycle end/i)).not.toBeInTheDocument()
  })

  it('labels a replay without implying another creation or grant', () => {
    render(<SubscriptionReview receipt={receipt(false)} state={state()} currentAccount={null} />)
    expect(screen.getByRole('heading', { name: 'Already completed' })).toBeInTheDocument()
    expect(screen.getByText(/original result of the same operation/i)).toBeInTheDocument()
  })

  it('keeps unresolved grant evidence bounded behind Load more', () => {
    const paged = state()
    paged.grantHistory.items = []
    paged.grantHistory.nextCursor = 'opaque'
    const onLoadMore = vi.fn()
    render(<SubscriptionReview receipt={receipt()} state={paged} currentAccount={null} onLoadMore={onLoadMore} hasNextPage />)
    expect(matchSubscriptionReceipt(receipt(), paged)).toEqual({ subscription: true, grant: false, mismatch: false })
    screen.getByRole('button', { name: 'Load more grant history' }).click()
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
