import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as planApi from '../../api/billingPlanApi'
import type {
  BillingAccountSnapshot,
  BillingSubscriptionPlanChangePreview,
  BillingSubscriptionState,
} from '../../types/billing'
import { SubscriptionPlanChangeControls } from './SubscriptionPlanChangeControls'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUBSCRIPTION = '11111111-2222-3333-8444-555555555555'
const OPERATION = '01991f20-1234-7abc-8abc-1234567890ab'
const LOCAL = '2026-09-22T12:00:00.123456'
const entitlements = { schemaVersion: 1 as const,
  rateLimits: { requestsPerMinute: 60, concurrentAiOperations: 4 },
  featureFlags: { contentGeneration: true, imageGeneration: false } }
const STATE = { clientId: CLIENT, stateAsOf: LOCAL,
  current: { subscriptionId: SUBSCRIPTION, creationOperationId: OPERATION,
    planTermsOperationId: OPERATION, clientId: CLIENT, planName: 'Basic',
    subscriptionTier: 'brand' as const, tierRevision: '3', cycleCreditAmount: '1000.0000',
    entitlements, changeEffectivePolicy: 'immediate' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const, billingCycleAnchor: LOCAL, status: 'active' as const,
    validFrom: LOCAL, validTo: null, createdAt: LOCAL, updatedAt: LOCAL },
  pendingChange: null, subscriptionHistory: [],
  grantHistory: { items: [], historyAsOf: LOCAL, nextCursor: null },
} satisfies BillingSubscriptionState
const ACCOUNT = { creditAccountId: '22222222-2222-4333-8444-555555555555', clientId: CLIENT,
  ownedBalance: '100.0000', activelyReservedAmount: '0.0000', availableBalance: '100.0000',
  activeReservationCount: 0, status: 'active' as const, asOf: LOCAL, walletVersion: '4' } satisfies BillingAccountSnapshot
const PREVIEW = { schemaVersion: 1 as const, action: 'schedule' as const,
  previewToken: `v1.${'a'.repeat(64)}`, previewedAt: LOCAL,
  currentTerms: { planName: 'Basic', cycleCreditAmount: '1000.0000', entitlements,
    changeEffectivePolicy: 'immediate' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const }, targetTerms: { planName: 'Basic',
    cycleCreditAmount: '1000.0000', entitlements,
    changeEffectivePolicy: 'next_billing_cycle' as const, prorationPolicy: 'prorate' as const,
    unusedCreditPolicy: 'rollover' as const }, pendingChangeBefore: null,
  pendingResult: 'created' as const, effectiveCycle: { cycleIndex: 2, cycleStart: LOCAL,
    cycleEnd: '2026-10-22T12:00:00.123456' }, creditEffect: {
      timing: 'next_billing_cycle' as const, currentCycleCreditAmount: '1000.0000',
      targetCycleCreditAmount: '1000.0000', calculation: null, account: null },
  pendingImmediateDebitAfter: null } satisfies BillingSubscriptionPlanChangePreview

function renderControls(state: BillingSubscriptionState = STATE,
  preview: BillingSubscriptionPlanChangePreview = PREVIEW) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const fresh = { subscription: state, account: ACCOUNT }
  const preflight = vi.fn().mockResolvedValue(fresh)
  const previewRequest = vi.spyOn(planApi, 'previewBillingPlanChange').mockResolvedValue(preview)
  render(<QueryClientProvider client={client}><SubscriptionPlanChangeControls
    clientId={CLIENT} state={state} account={ACCOUNT} preflight={preflight}
  /></QueryClientProvider>)
  return { client, preflight, previewRequest }
}

describe('SubscriptionPlanChangeControls', () => {
  it('requires an intentional action and keeps financial controls distinct from tier', async () => {
    renderControls()
    expect(screen.getByRole('button', { name: 'Preview selected financial action' })).toBeDisabled()
    expect(screen.queryByLabelText('Plan name')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('radio', {
      name: 'Schedule terms for next billing cycle',
    }))
    expect(screen.getByLabelText('Plan name')).toHaveValue('Basic')
    expect(screen.getByText(/No subscription tier, classification/)).toBeInTheDocument()
  })

  it('loads fresh authority and presents server-owned saved-zone cycle evidence', async () => {
    const { preflight } = renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Schedule terms for next billing cycle' }))
    const trigger = screen.getByRole('button', { name: 'Preview selected financial action' })
    await user.click(trigger)
    expect(preflight).toHaveBeenCalledTimes(1)
    const dialog = await screen.findByRole('dialog', { name: 'Confirm financial plan change' })
    expect(dialog).toHaveTextContent(`${LOCAL} to 2026-10-22T12:00:00.123456`)
    expect(dialog).toHaveTextContent('No tier, classification, payment, invoice, revenue, or validity change')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it.each(['0', '0.0', '0.0000'])(
    'rejects zero credit amount %s before preflight or preview', async (amount) => {
      const { preflight, previewRequest } = renderControls()
      const user = userEvent.setup()
      await user.click(screen.getByRole('radio', { name: 'Schedule terms for next billing cycle' }))
      const credit = screen.getByLabelText(/Cycle credit amount/)
      await user.clear(credit)
      await user.type(credit, amount)
      await user.click(screen.getByRole('button', { name: 'Preview selected financial action' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Review the linked plan name, exact credit amount, and positive entitlement limits.')
      expect(preflight).not.toHaveBeenCalled()
      expect(previewRequest).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog', { name: 'Confirm financial plan change' })).not.toBeInTheDocument()
    },
  )

  it('accepts an exact positive fractional credit amount', async () => {
    const { preflight, previewRequest } = renderControls()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Schedule terms for next billing cycle' }))
    const credit = screen.getByLabelText(/Cycle credit amount/)
    await user.clear(credit)
    await user.type(credit, '0.0001')
    await user.click(screen.getByRole('button', { name: 'Preview selected financial action' }))

    expect(await screen.findByRole('dialog', { name: 'Confirm financial plan change' })).toBeInTheDocument()
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(previewRequest).toHaveBeenCalledWith(
      CLIENT,
      SUBSCRIPTION,
      expect.objectContaining({ cycleCreditAmount: '0.0001' }),
      expect.any(AbortSignal),
    )
  })

  it('offers only replace and cancel for the exact supported pending financial operation', () => {
    const pending = { ...STATE, pendingChange: { schemaVersion: 1,
      planChangeOperationId: '01991f20-5678-7abc-8abc-1234567890ab', planName: 'Pro',
      cycleCreditAmount: '1250.0000', entitlements,
      changeEffectivePolicy: 'next_billing_cycle' as const, prorationPolicy: 'prorate' as const,
      unusedCreditPolicy: 'rollover' as const, effectiveCycleIndex: 2,
      effectiveCycleStart: LOCAL, effectiveCycleEnd: '2026-10-22T12:00:00.123456',
      scheduledAt: LOCAL } } satisfies BillingSubscriptionState
    renderControls(pending)
    expect(screen.getByRole('radio', { name: 'Replace pending financial terms' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Cancel pending financial terms' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Schedule terms for next billing cycle' })).not.toBeInTheDocument()
  })

  it('blocks unsupported pending state and exposes it as read-only', () => {
    renderControls({ ...STATE, pendingChange: { status: 'unsupported' } })
    expect(screen.getByRole('alert')).toHaveTextContent('unsupported schema')
    expect(screen.queryByRole('button', { name: 'Preview selected financial action' })).not.toBeInTheDocument()
  })
})
